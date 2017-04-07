import koa_router from 'koa-router';
import koa_body from 'koa-body';
import fetch from 'node-fetch';
import models, {esc, escAttrs, Sequelize, sequelize} from 'db/models';
import findUser from 'db/utils/find_user';
import config from 'config';
import recordWebEvent from 'server/record_web_event';
import {
	emailRegex,
	getRemoteIp,
	rateLimitReq,
	checkCSRF,
	encryptPrivateKey,
	decryptPrivateKey
} from 'server/utils';
import coBody from 'co-body';
import {getLogger} from '../../app/utils/Logger'
import {Apis} from 'shared/api_client';
import {createTransaction, signTransaction} from 'shared/chain/transactions';
import {ops} from 'shared/serializer';
import isToday from 'date-fns/is_today';
import isAfter from 'date-fns/is_after';
import format from 'date-fns/format'
import addDays from 'date-fns/add_days'
import addHours from 'date-fns/add_hours'
import AWS from 'aws-sdk';
import pify from 'pify';
import fs from 'fs';
import {flatten, divide} from 'lodash';
import {filter, negate, isNil, size, compose, reduce, map, prop} from 'lodash/fp'
import FormData from 'form-data';
import shortid from 'shortid';

const {signed_transaction} = ops;
const print = getLogger('API - general').print

AWS.config.update({
	accessKeyId: config.aws.accessKeyId,
	secretAccessKey: config.aws.secretAccessKey,
	signatureVersion: 'v4'
});

function dbStoreSingleMeta(name, k, v) {
	models.AccountMeta.findOne({
		attributes: [
			'accname', 'k', 'v'
		],
		where: {
			accname: esc(name),
			k: esc(k)
		}
	}).then(function (it) {
		if (it) {
			if (it.dataValues.v !== v)
				models.AccountMeta.update({
					v: esc(v)
				}, {
					where: {
						accname: esc(name),
						k: esc(k)
					}
				});
		}
		else {
			models.AccountMeta.create({accname: esc(name), k: esc(k), v: esc(v)});
		}
	});
}

export default function useGeneralApi(app) {
	const router = koa_router({
		prefix: '/api/v1'
	});
	app.use(router.routes());
	const koaBody = koa_body({multipart: true});

	router.post('/get_account_private_key', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;
		const params = this.request.body;
		const {csrf, username} = typeof(params) === 'string' ? JSON.parse(params) : params;
		//if (!checkCSRF(this, csrf)) return;
		const account = yield models.Account.findOne({
			attributes: ['private_key'],
			where: {
				name: username
			}
		});
		if (account) {
			this.body = JSON.stringify({
				private_key: account.private_key
			});
			this.status = 200;
			return;
		} else {
			this.body = JSON.stringify({
				error: "Account not found"
			});
			this.status = 404;
		}
		recordWebEvent(this, 'api/get_account_private_key', username);
	});

	router.post('/accounts', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;
		const params = this.request.body;
		print('params', params)
		const account = typeof(params) === 'string' ? JSON.parse(params) : params;
		//  if (!checkCSRF(this, account.csrf)) return;
		console.log('-- /accounts -->', this.session.uid, this.session.user, account);

		if ($STM_Config.disable_signups) {
			this.body = JSON.stringify({
				error: 'New signups are temporary disabled.'
			});
			this.status = 401;
			return;
		}

		try {
			const meta = {}
			const remote_ip = getRemoteIp(this.req);
			const user_id = this.session.user;
			if (!user_id) { // require user to sign in with identity provider
				this.body = JSON.stringify({
					error: 'Unauthorized'
				});
				this.status = 401;
				return;
			}

			const user = yield models.User.findOne({
				attributes: ['verified', 'waiting_list'],
				where: {
					id: user_id
				}
			});
			if (!user) {
				this.body = JSON.stringify({
					error: 'Unauthorized'
				});
				this.status = 401;
				return;
			}

			const existing_account = yield models.Account.findOne({
				attributes: ['id', 'created_at'],
				where: {user_id, ignored: false},
				order: 'id DESC'
			});
			if (existing_account) { //TODO
				throw new Error("Only one Steem account per user is allowed in order to prevent abuse (Steemit, Inc. funds each new account with 3 STEEM)");
			}

			const same_ip_account = yield models.Account.findOne({
				attributes: ['created_at'],
				where: {
					remote_ip: esc(remote_ip)
				},
				order: 'id DESC'
			});
			if (same_ip_account) {
				const minutes = (Date.now() - same_ip_account.created_at) / 60000;
				if (minutes < 10) {
					console.log(`api /accounts: IP rate limit for user ${this.session.uid} #${user_id}, IP ${remote_ip}`);
					throw new Error('Only one Steem account allowed per IP address every 10 minutes');
				}
			}
			if (user.waiting_list) {
				console.log(`api /accounts: waiting_list user ${this.session.uid} #${user_id}`);
				throw new Error('You are on the waiting list. We will get back to you at the earliest possible opportunity.');
			}
			const eid = yield models.Identity.findOne({
				attributes: ['id'],
				where: {
					user_id,
					provider: 'email',
					verified: true
				},
				order: 'id DESC'
			});
			if (!eid) {
				console.log(`api /accounts: not confirmed email for user ${this.session.uid} #${user_id}`);
				throw new Error('Email address is not confirmed');
			}
			yield createAccount({
				signingKey: config.registrar.signing_key,
				fee: config.registrar.fee,
				creator: config.registrar.account,
				new_account_name: account.name,
				json_metadata: JSON.stringify(new Object()),
				owner: account.owner_key,
				active: account.active_key,
				posting: account.posting_key,
				memo: account.memo_key,
				broadcast: true
			});
			console.log('-- create_account_with_keys created -->', this.session.uid, account.name, user.id, account.owner_key);

			this.body = JSON.stringify({
				status: 'ok'
			});
			models.Account.create(escAttrs({
				user_id,
				name: account.name,
				owner_key: account.owner_key,
				active_key: account.active_key,
				posting_key: account.posting_key,
				memo_key: account.memo_key,
				remote_ip,
				referrer: this.session.r
			})).then(instance => {
			})
				.catch(error => {
					console.error('!!! Can\'t create account model in /accounts api', this.session.uid, error);
				});
		} catch (error) {
			console.error('Error in /accounts api call', this.session.uid, error.toString());
			this.body = JSON.stringify({
				error: error.message
			});
			this.status = 500;
		}
		recordWebEvent(this, 'api/accounts', account ? account.name : 'n/a');
	});

	router.post('/update_email', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;
		const params = this.request.body;
		const {
			csrf,
			email
		} = typeof(params) === 'string' ? JSON.parse(params) : params;
		//  if (!checkCSRF(this, csrf)) return;
		console.log('-- /update_email -->', this.session.uid, email);
		try {
			if (!emailRegex.test(email.toLowerCase())) throw new Error('not valid email: ' + email);
			// TODO: limit by 1/min/ip
			let user = yield findUser({
				user_id: this.session.user,
				email: esc(email),
				uid: this.session.uid
			});
			if (user) {
				user = yield models.User.update({
					email: esc(email),
					waiting_list: true
				}, {
					where: {
						id: user.id
					}
				});
			} else {
				user = yield models.User.create({
					email: esc(email),
					waiting_list: true
				});
			}
			this.session.user = user.id;
			this.body = JSON.stringify({
				status: 'ok'
			});
		} catch (error) {
			console.error('Error in /update_email api call', this.session.uid, error);
			this.body = JSON.stringify({
				error: error.message
			});
			this.status = 500;
		}
		recordWebEvent(this, 'api/update_email', email);
	});

	router.post('/bm_signup', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;
		const params = this.request.body;
		const {
			csrf,
			email,
			name,
			lastname
		} = typeof(params) === 'string' ? JSON.parse(params) : params;
		//  if (!checkCSRF(this, csrf)) return;
		console.log('-- /sign up BM -->', this.session.uid, email, name, lastname);
		try {
			if (!emailRegex.test(email.toLowerCase())) throw new Error('not valid email: ' + email);
			// TODO: limit by 1/min/ip

			const getBMtoken = yield getBMAccessTokenCredentialsOnly();

			const getBMNewUser = yield getBMSignUp(email, name, lastname, getBMtoken.access_token);


			console.log('BM SignUP Server: ', email, name, lastname)

			this.body = JSON.stringify({
				status: 'ok'
			});


		} catch (error) {
			console.error('Error in /bmsignup api call', this.session.uid, error);
			this.body = JSON.stringify({
				error: error.message
			});
			this.status = 500;
		}
		recordWebEvent(this, 'api/bmsignup', email);
	});


	router.post('/bm_recovery', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;
		const params = this.request.body;
		const {
			csrf,
			email

		} = typeof(params) === 'string' ? JSON.parse(params) : params;
		//  if (!checkCSRF(this, csrf)) return;
		console.log('-- /recovery BM -->', this.session.uid, email);
		try {
			if (!emailRegex.test(email.toLowerCase())) throw new Error('not valid email: ' + email);
			// TODO: limit by 1/min/ip

			const getBMtoken = yield getBMAccessTokenCredentialsOnly();

			const getBMRecovered = yield getBMRecovery(email, getBMtoken.access_token);


			console.log('BM Recovered: ', email)

			this.body = JSON.stringify({
				status: 'ok'
			});


		} catch (error) {
			console.error('Error in /bm_recovery api call', this.session.uid, error);
			this.body = JSON.stringify({
				error: error.message
			});
			this.status = 500;
		}
		recordWebEvent(this, 'api/bm_recovery', email);
	});


	router.post('/bm_program', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;
		const params = this.request.body;
		const {
			csrf,
			email,
			password

		} = typeof(params) === 'string' ? JSON.parse(params) : params;
		//  if (!checkCSRF(this, csrf)) return;
		console.log('-- /program  -->', this.session.uid, email);
		try {
			//if (!emailRegex.test(email.toLowerCase())) throw new Error('not valid email: ' + email);
			// TODO: limit by 1/min/ip

			//const getBMtoken = yield getBMAccessToken(email, password);

			let getBMProg = ''
			let whereClause = ''

			let isEmail = false
			if (email.indexOf('@') > -1) {
				whereClause = {email: esc(email)}
        isEmail = true
			} else whereClause = {name: esc(email)}

			console.log('WhereClause: ', whereClause)


			// if (getBMtoken) {

			getBMProg = yield models.User.findOne({
				attributes: [
          'id',
					'current_program',
					'volunteer',
					'ten',
					'hundred',
					'polk',
					'hundred_leader',
					'polk_leader',
					'couch_group',
          'email',
          'all_programs'
				],
				where: whereClause
			})
			// }

      if (!getBMProg.current_program && email) {
        let getBMtoken
        let user_email

        if (email.indexOf('@') === -1) {
          user_email = getBMProg.email
        } else {
          user_email = email
        }

        console.log('user_email', user_email)
        console.log('password', password)

        if (password && isEmail) {
          getBMtoken = yield getBMAccessToken(user_email, password);
          getBMtoken = getBMtoken.access_token
        }

        if ((password && !isEmail) || (!password && isEmail)) {
          //const user = decodeURIComponent(this.cookies.get('molodost_user'))
          const hash = this.cookies.get('molodost_hash')
          const user_agent = this.headers['user-agent']
          getBMtoken = yield isUserAuthOnBM(user_email, hash, user_agent)
          console.log('get bm token', getBMtoken)
        }

        console.log('Program – BM User: ', getBMtoken)
        const getBMmeta = yield getBMUserMeta(getBMtoken);

        let bmID = getBMmeta.userId
        console.log('Program – BM ID: ', bmID)

        let ifCeh, ifMzs
        ifCeh = yield getBMProgramById(85, bmID, getBMtoken)
        ifMzs = yield getBMProgramById(87, bmID, getBMtoken)
        console.log('Program – BM Programs: ', ifCeh, ifMzs)

        if (ifCeh.valid) {
          getBMProg.current_program = '1'
          yield getBMProg.save()
        }
        if (ifMzs.valid) {
          getBMProg.current_program = '2'
          yield getBMProg.save()
        }
      }

      this.body = JSON.stringify({
        status: 'ok',
        bmprog: getBMProg
      });


		} catch (error) {
			console.error('Error in /bm_program api call', this.session.uid, error);
			this.body = JSON.stringify({
				error: error.message
			});
			this.status = 500;
		}
		// recordWebEvent(this, 'api/bm_program', email);
	});

	router.post('/user_hierarchy', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;
		const params = this.request.body;
		const {
			csrf,
			email
			// password

		} = typeof(params) === 'string' ? JSON.parse(params) : params;
		//  if (!checkCSRF(this, csrf)) return;

		try {
			//if (!emailRegex.test(email.toLowerCase())) throw new Error('not valid email: ' + email);
			// TODO: limit by 1/min/ip

			//const getBMtoken = yield getBMAccessToken(email, password);


			let getBMProg = ''

			// if (getBMtoken) {

			getBMProg = yield models.User.findOne({
				attributes: [
					'current_program',
					'volunteer',
					'ten',
					'hundred',
					'polk',
					'couch_group'

				],
				where: {
					name: esc(email)
				}

			})

			// }


			this.body = JSON.stringify({
				status: 'ok',
				hierarchy: getBMProg
			});


		} catch (error) {
			console.error('Error in /user_hierarchy api call', this.session.uid, error);
			this.body = JSON.stringify({
				error: error.message
			});
			this.status = 500;
		}
		// recordWebEvent(this, 'api/user_hierarchy', email);
	});


	router.post('/get_group_by_id', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;
		const params = this.request.body;
		const {
			csrf, id
			// password
		} = typeof(params) === 'string' ? JSON.parse(params) : params;
		//  if (!checkCSRF(this, csrf)) return;

		try {
			//if (!emailRegex.test(email.toLowerCase())) throw new Error('not valid email: ' + email);
			// TODO: limit by 1/min/ip

			//const getBMtoken = yield getBMAccessToken(email, password);

			let getBMProg = ''

			// if (getBMtoken) {

			getBMProg = yield models.User.findOne({
				attributes: ['name'],
				where: {id: esc(id)}
			})

			// }

			this.body = JSON.stringify({
				status: 'ok',
				name: getBMProg
			});


		} catch (error) {
			console.error('Error in /user_hierarchy api call', this.session.uid, error);
			this.body = JSON.stringify({
				error: error.message
			});
			this.status = 500;
		}
		// recordWebEvent(this, 'api/user_hierarchy', email);
	});


	router.post('/login2', koaBody, function*() {
		//  if (rateLimitReq(this, this.req)) return;
		const params = this.request.body;
		const {
			csrf,
			username,
			password
		} = typeof(params) === 'string' ? JSON.parse(params) : params;

		console.log('session', this.session)

		console.log('SERV', username, password);

    const user = decodeURIComponent(this.cookies.get('molodost_user'))
    const hash = this.cookies.get('molodost_hash')
    const user_agent = this.headers['user-agent']

    let isAuth = false


    if (username && !password) {
      isAuth = yield isUserAuthOnBM(user, hash, user_agent)
      console.log('is auth', isAuth)

    }

    console.log('LOGIN2 Auth: ', isAuth, user, username, password)

		// if (!checkCSRF(this, csrf)) return;

		try {

			// Первый этап
			// Проверить есть ли пользователь на БМ
			const userExistBM = yield getBMAccessToken(username, password);

			console.log('BM check: ' + userExistBM.access_token);

			// If user account have in DB
			if (userExistBM.access_token || isAuth) {
				// Проверить есть ли пользователь в нашей БД
				const db_account = yield models.Account.findOne({
					attributes: ['user_id', 'private_key', 'name'],
					where: {
						email: esc(username)
					}
				});

				// If user accoun have in DB
				if (db_account) {

					let DectryptedKey = decryptPrivateKey(db_account.private_key);
					console.log('DECRYPTED: ', DectryptedKey)
					this.session.a = username;
					this.session.user = db_account.user_id;
					console.log('SERVKEY', db_account.name, db_account.private_key)
					this.body = JSON.stringify({
						status: 'ok',
						name: db_account.name,
						private_key: DectryptedKey
					});

					console.log('Server response after login: ', this.body)
				} else {
					this.body = JSON.stringify({
						error_status: 'db-user-not-found',
						error: 'No account found from MYSQL'
					});
					this.status = 500;
				}
			} else {
				this.body = JSON.stringify({
					error_status: 'bm-user-not-found',
					error: 'No account found from BM'
				});
			}
		} catch (error) {
			console.error('Error in /login2 api call', this.session.uid, error);
			this.body = JSON.stringify({
				error: error.message
			});
			this.status = 500;
		}
		recordWebEvent(this, 'api/login2', username);
	})

	router.post('/check_user', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;
		const params = this.request.body;
		const {
			csrf,
			username
		} = typeof(params) === 'string' ? JSON.parse(params) : params;
		//if (!checkCSRF(this, csrf)) return;
		console.log('-- /check_user -->', this.session.uid, username);
		const account = yield models.Account.findOne({
			where: {
				name: esc(username)
			}
		})
		if (account) {
			this.body = JSON.stringify({
				user_exist: true
			})
		} else {
			this.body = JSON.stringify({
				user_exist: false
			})
		}
		recordWebEvent(this, 'api/check_user', account);
	})

	router.post('/login_account', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;
		const params = this.request.body;
		const {
			csrf,
			account
		} = typeof(params) === 'string' ? JSON.parse(params) : params;
		//if (!checkCSRF(this, csrf)) return;
		console.log('-- /login_account -->', this.session.uid, account);
		try {
			this.session.a = account;
			const db_account = yield models.Account.findOne({
				attributes: ['user_id'],
				where: {
					name: esc(account)
				}
			});
			if (db_account) this.session.user = db_account.user_id;
			this.body = JSON.stringify({
				status: 'ok'
			});
		} catch (error) {
			console.error('Error in /login_account api call', this.session.uid, error);
			this.body = JSON.stringify({
				error: error.message
			});
			this.status = 500;
		}
		recordWebEvent(this, 'api/login_account', account);
	});

	router.post('/logout_account', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return; // - logout maybe immediately followed with login_attempt event
		const params = this.request.body;
		const {
			csrf
		} = typeof(params) === 'string' ? JSON.parse(params) : params;
		//if (!checkCSRF(this, csrf)) return;
		console.log('-- /logout_account -->', this.session.uid);
		try {

			//const user = decodeURIComponent(this.cookies.get('molodost_user'))
    		//const hash = this.cookies.get('molodost_hash')
    		//const user_agent = this.headers['user-agent']

      		//let bmToken = yield isUserAuthOnBM(user, hash, user_agent)
      		//console.log('REVOKING TOKEN GET: ', bmToken)

			//let revokeToken
			//if(bmToken) revokeToken = yield revokeBMAccessToken(bmToken)
			//console.log('REVOKED: ', revokeToken)

			this.session.a = null;
			this.session.name = null;
			this.session.user = null;
			this.session.uid = Math.random().toString(36).slice(2);







			this.body = JSON.stringify({
				status: 'ok'
			});
		} catch (error) {
			console.error('Error in /logout_account api call', this.session.uid, error);
			this.body = JSON.stringify({
				error: error.message
			});
			this.status = 500;
		}
	});

	router.post('/record_event', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;
		try {
			const params = this.request.body;
			const {
				csrf,
				type,
				value
			} = typeof(params) === 'string' ? JSON.parse(params) : params;
			//if (!checkCSRF(this, csrf)) return;
			console.log('-- /record_event -->', this.session.uid, type, value);
			const str_value = typeof value === 'string' ? value : JSON.stringify(value);
			this.body = JSON.stringify({
				status: 'ok'
			});
			recordWebEvent(this, type, str_value);
		} catch (error) {
			console.error('Error in /record_event api call', error);
			this.body = JSON.stringify({
				error: error.message
			});
			this.status = 500;
		}
	});

	router.post('/csp_violation', function*() {
		if (rateLimitReq(this, this.req)) return;
		const params = yield coBody.json(this);
		console.log('-- /csp_violation -->', this.req.headers['user-agent'], params);
		this.body = '';
	});

	router.post('/account_update_hook', koaBody, function *() {
		//if (rateLimitReq(this, this.req)) return;
		const params = this.request.body;
		let {csrf, account_name} = typeof(params) === 'string'
			? JSON.parse(params)
			: params;
		//if (!checkCSRF(this, csrf))
		return; // disable for mass operations
		console.log(account_name);
		// expect array
		if (typeof account_name === 'string') account_name = [account_name]
		this.body = JSON.stringify({status: 'in process'});
		Apis.db_api('get_accounts', account_name).then(function (response) {
			if (!response)
				return;
			response.forEach(function (account) {
				const json_metadata = account.json_metadata;
				const name = account.name;
				var meta = null
				console.log('updating meta for acc ' + name);
				try {
					meta = JSON.parse(json_metadata)
				} catch (e) {
					console.log(`account ${name} has invalid json_metadata`);
					return;
				}
				for (var p in meta) {
					if (meta.hasOwnProperty(p)) {
						dbStoreSingleMeta(name, p, meta[p]);
					}
				}
			})
		}).catch(function (error) {
			console.log("error when updating account meta table", error)
		});
	});


	router.post('/get_account_private_key', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;
		const params = this.request.body;
		const {csrf, username} = typeof(params) === 'string' ? JSON.parse(params) : params;
		//if (!checkCSRF(this, csrf)) return;
		const account = yield models.Account.findOne({
			attributes: ['private_key'],
			where: {
				name: username
			}
		});
		if (account) {
			this.body = JSON.stringify({
				private_key: account.private_key
			});
			this.status = 200;
			return;
		} else {
			this.body = JSON.stringify({
				error: "Account not found"
			});
			this.status = 404;
		}
		recordWebEvent(this, 'api/get_account_private_key', username);
	});

	router.post('/accounts2', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;


		const params = this.request.body;
		print('params', params)
		const account = typeof(params) === 'string' ? JSON.parse(params) : params;
		// if (!checkCSRF(this, account.csrf)) return;
		console.log('-- /accounts -->', this.session.uid, this.session.user, account);

		if ($STM_Config.disable_signups) {
			this.body = JSON.stringify({
				error: 'New signups are temporary disabled.'
			});
			this.status = 401;
			return;
		}

		try {
			const meta = {}
			const remote_ip = getRemoteIp(this.req);

			/* if (same_ip_account) {
			 const minutes = (Date.now() - same_ip_account.created_at) / 60000;
			 if (minutes < 10) {
			 console.log(`api /accounts: IP rate limit for user ${this.session.uid} #${user_id}, IP ${remote_ip}`);
			 throw new Error('Only one Steem account allowed per IP address every 10 minutes');
			 }
			 } */


			let getBMtoken




			if (account.bmpassword) {getBMtoken = yield getBMAccessToken(account.email, account.bmpassword);
				getBMtoken = getBMtoken.access_token}
			if (account.email && !account.bmpassword)  {

				 const user = decodeURIComponent(this.cookies.get('molodost_user'))
    		const hash = this.cookies.get('molodost_hash')
    		const user_agent = this.headers['user-agent']

      		getBMtoken = yield isUserAuthOnBM(user, hash, user_agent)
      		}

			const getBMmeta = yield getBMUserMeta(getBMtoken);
			const accountMetaData = {
				first_name: getBMmeta.firstName,
				last_name: getBMmeta.lastName,
				age: getBMmeta.birthDate,
				facebook: getBMmeta.fbId,
				vk: getBMmeta.vkId,
				website: getBMmeta.siteLink,
				user_image: 'http://static.molodost.bz/thumb/160_160_2/img/avatars/' + getBMmeta.avatar,

			}


			const attrs = {
				uid: this.session.uid ? this.session.uid : account.name,
				name: account.name,
				email: account.email,
				first_name: getBMmeta.firstName ? getBMmeta.firstName : 'Без',
				last_name: getBMmeta.lastName ? getBMmeta.lastName : 'имени',
				birthday: getBMmeta.age ? getBMmeta.age : null,
				gender: null,
				picture_small: getBMmeta.avatar ? 'http://static.molodost.bz/thumb/160_160_2/img/avatars/' + getBMmeta.avatar : '',
				location_id: null,
				location_name: null,
				locale: null,
				timezone: null,
				remote_ip: getRemoteIp(this.request.req),
				verified: true,
				waiting_list: false,
				facebook_id: getBMmeta.fbId ? getBMmeta.fbId : ''
			};

			const i_attrs = {
				provider: 'bm',
				uid: account.name,
				name: account.name,
				email: account.email,
				verified: true,
				provider_user_id: null
			};

			let user;
			let identity;
			user = yield models.User.create(attrs);

			i_attrs.user_id = user.id;


			console.log('-- BM created user -->', user.id);

			identity = yield models.Identity.create(i_attrs);
			console.log('-- BM created identity -->', this.session.uid, identity.id);


			this.session.user = user.id;


			console.log('MetaData:', accountMetaData)
			yield createAccount({
				signingKey: config.registrar.signing_key,
				fee: config.registrar.fee,
				creator: config.registrar.account,
				new_account_name: account.name,
				json_metadata: JSON.stringify(accountMetaData),
				owner: account.owner_key,
				active: account.active_key,
				posting: account.posting_key,
				memo: account.memo_key,
				broadcast: true
			});
			console.log('-- create_account_with_keys created -->', this.session.uid, account.name, user.id, account.owner_key);

			const encryptedPassword = encryptPrivateKey(account.password);

			this.body = JSON.stringify({
				status: 'ok',
				account: account,
				private_key: encryptedPassword
			});
			yield models.Account.create(escAttrs({
				user_id: user.id,
				name: account.name,
				owner_key: account.owner_key,
				active_key: account.active_key,
				posting_key: account.posting_key,
				memo_key: account.memo_key,
				remote_ip,
				private_key: encryptedPassword,
				email: account.email,
				referrer: this.session.r
			})).then(instance => {
			})
				.catch(error => {
					console.error('!!! Can\'t create account model in /accounts2 api', this.session.uid, error);
				});
		} catch (error) {
			console.error('Error in /accounts2 api call', this.session.uid, error.toString());
			this.body = JSON.stringify({
				error: error.message
			});
			this.status = 500;
		}
		recordWebEvent(this, 'api/accounts2', account ? account.name : 'n/a');

		console.log('SERVER RETURNED ACCOUNT: ', account);
		return account;
	});

	router.post('/user/update_money', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;
		const params = this.request.body;
		const {csrf, payload} = typeof(params) === 'string' ? JSON.parse(params) : params;
		//if (!checkCSRF(this, csrf)) return;

		const user = yield models.User.findOne({
			where: {
				name: payload.username
			}
		})

		const last_transaction = user.last_money_transaction

		if (!last_transaction) {
			yield user.update({
				money_total: user.last_day_money + Number(payload.money),
				last_money_transaction: new Date()
			})
			if (payload.type === 'submit_story') {
				yield user.update({
					posts_monets: 1
				})
			}
			if (payload.type === 'submit_comment') {
				yield user.update({
					comments_monets: 1
				})
			}
			if (payload.type === 'reply_to_task') {
				yield user.update({
					tasks_monets: 2
				})
			}
		}

		if (isToday(last_transaction)) {
			yield user.update({
				money_total: user.last_day_money + Number(payload.money)
			})
			if (payload.type === 'submit_story') {
				yield user.update({
					posts_monets: 1
				})
			}
			if (payload.type === 'submit_comment') {
				yield user.update({
					comments_monets: 1
				})
			}
			if (payload.type === 'reply_to_task') {
				yield user.update({
					tasks_monets: 2
				})
			}
		}

		if (last_transaction && isAfter((new Date()).setHours(0, 0, 0, 0), last_transaction)) {
			console.log('now', (new Date()).setHours(0, 0, 0, 0), 'last', last_transaction)
			console.log('is now after last', isAfter((new Date()).setHours(0, 0, 0, 0), last_transaction))
			yield user.update({
				last_day_money: user.money_total,
				money_total: user.money_total + Number(payload.money),
				last_money_transaction: new Date(),
				posts_monets: 0,
				comments_monets: 0,
				tasks_monets: 0,
				monets: user.monets + user.posts_monets + user.comments_monets + user.tasks_monets
			})
		}

		this.body = JSON.stringify({
			'receive payload': payload
		});
	});

	router.get('/users', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;
		const {category, ten, hundred, polk, couch_group, search, offset, limit, program} = this.query
		let where = {}
		let type = null
		let _offset = Number(offset) || 0
		let _limit = Number(limit) || 50
		let _order = this.query.order !== 'undefined' ? this.query.order : null

		let users = []

		if (category) {
			if (category === 'polki') {
				where = {
				$and: [{
							polk_leader: true,
						},
						{
							current_program: program
						}]
				}
				type = 'polk'
			}
			if (category === 'hundreds') {
				where = {
					$and: [{
					hundred_leader: true,
				},
				{
					current_program: program
				}]
				}
				type = 'hundred'
			}
			if (category === 'tens') {
				where = {
					$and: [{
					ten_leader: true,
				},
				{
					current_program: program
				}]
				}
				type = 'ten'
			}

			if (category === 'couches') {
				type = 'couch'
				if (program === '2') {
					type = 'couch_mzs'
				}

				users = yield models.Group.findAll({
					attributes: [
						'id',
						'money',
						'monets'
					],
					include: [{
						model: models.User,
						attributes: ['id', 'first_name', 'last_name', 'name'],
						where: {
  						couch: true,
  						couch_group: null,
							$or: [{
								current_program: program
							}, {
								all_programs: true
							}]
						}
					}],
					where: {
						type
					},
					order: [['money', 'desc'], [{ model: models.User }, 'id']],
					limit: 100
				})

				this.body = JSON.stringify({users})
				return
			}

			if (category === 'hundred_leader') {
				where = {
					$or: [{
						polk: this.session.user
					}, {
						polk: null
					}]
				}
			}
			if (category === 'ten_leader') {
				where = {
					$or: [{
						hundred: this.session.user
					}, {
						hundred: null
					}]
				}
			}

			if (category === 'all' && program) {
				where = {
					current_program: program
				}
			}
		}

		if (ten) {
			where = {ten}
			_order = 'money_total'
		}

		if (hundred) {
			where = {ten_leader: true, hundred}
			type = 'ten'
		}

		if (polk) {
			where = {hundred_leader:true, polk}
			type = 'hundred'
		}

		if (couch_group) {
			where = {
				couch_group,
				current_program: program
			}
			_order = 'money_total'
		}

		if (search) {
			where = Sequelize.where(
				Sequelize.fn('concat', Sequelize.col('first_name'), ' ', Sequelize.col('last_name')),
				{
					$like: `%${search}%`
				}
			)
			_limit = null
			_offset = 0
		}
		const groupsInclude = {
			model: models.Group,
			where: {
				type: type
			},
			required: false,
			attributes: ['money']
		}
		let order
		category !== 'all'
			? order = [groupsInclude, 'money', 'DESC']
			: order = ['money_total', 'DESC']



		if (_order) {
			order = [_order, 'DESC']
		}

		users = yield models.User.findAll({
			attributes: [
				'id',
				'name',
				'first_name',
				'last_name',
				'ten',
				'hundred',
				'polk',
				'ten_leader',
				'hundred_leader',
				'polk_leader',
				'couch_group',
				'couch',
				'money_total',
				'approved_money',
				'volunteer'
			],
			where,
			order: [order, ['id']],
			include: [groupsInclude],
			offset: _offset,
			limit: _limit
		})

		this.body = JSON.stringify({users})
	})

	router.get('/gameusers', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;
		const {category, ten, hundred, polk, couch_group, search, offset, limit, program, task} = this.query

		let result
		let taskId = task ? task : 1
		if (category === 'all') {
			result = yield sequelize.query(`
				SELECT
					users.id,
					users.name,
					AVG(score_1) AS total_score_1,
					AVG(score_2) AS total_score_2,
					AVG(score_3) AS total_score_3,
					AVG(score_1 + score_2 + score_3) / 3 AS total_score
				FROM users
				LEFT JOIN game ON game.user_id = users.id
				LEFT JOIN game_scores ON game_scores.game_id = game.id
				WHERE task = ? AND users.current_program = ?
				GROUP BY users.id
				ORDER BY total_score DESC, users.id
				LIMIT 50
			`, { model: models.User, replacements: [taskId, program]})
		} else if (category === 'polki') {
			result = yield sequelize.query(`
				SELECT
					users.polk AS id,
					(SELECT u2.name FROM users u2 WHERE u2.id = users.polk AND u2.polk_leader = 1) AS name,
					(SELECT u2.first_name FROM users u2 WHERE u2.id = users.polk AND u2.polk_leader = 1) AS first_name,
					(SELECT u2.last_name FROM users u2 WHERE u2.id = users.polk AND u2.polk_leader = 1) AS last_name,
					AVG(score_1) AS total_score_1,
					AVG(score_2) AS total_score_2,
					AVG(score_3) AS total_score_3,
					AVG(score_1 + score_2 + score_3) / 3 AS total_score
				FROM users
				LEFT JOIN game ON game.user_id = users.id
				LEFT JOIN game_scores ON game_scores.game_id = game.id
				WHERE users.polk IS NOT NULL AND task = ? AND users.current_program = ?
				GROUP BY users.polk
				ORDER BY total_score DESC, id
				LIMIT 50
			`, { model: models.User, replacements: [taskId, program] })
		} else if (category === 'hundreds') {
			result = yield sequelize.query(`
				SELECT
					users.hundred AS id,
					(SELECT u2.name FROM users u2 WHERE u2.id = users.hundred AND u2.hundred_leader = 1) AS name,
					(SELECT u2.first_name FROM users u2 WHERE u2.id = users.hundred AND u2.hundred_leader = 1) AS first_name,
					(SELECT u2.last_name FROM users u2 WHERE u2.id = users.hundred AND u2.hundred_leader = 1) AS last_name,
					AVG(score_1) AS total_score_1,
					AVG(score_2) AS total_score_2,
					AVG(score_3) AS total_score_3,
					AVG(score_1 + score_2 + score_3) / 3 AS total_score
				FROM users
				LEFT JOIN game ON game.user_id = users.id
				LEFT JOIN game_scores ON game_scores.game_id = game.id
				WHERE users.hundred IS NOT NULL AND task = ? AND users.current_program = ?
				GROUP BY users.hundred
				ORDER BY total_score DESC, id
				LIMIT 50
			`, { model: models.User, replacements: [taskId, program] })
		} else if (category === 'tens') {
			result = yield sequelize.query(`
				SELECT
					users.ten AS id,
					(SELECT u2.name FROM users u2 WHERE u2.id = users.ten AND u2.ten_leader = 1) AS name,
					(SELECT u2.first_name FROM users u2 WHERE u2.id = users.ten AND u2.ten_leader = 1) AS first_name,
					(SELECT u2.last_name FROM users u2 WHERE u2.id = users.ten AND u2.ten_leader = 1) AS last_name,
					AVG(score_1) AS total_score_1,
					AVG(score_2) AS total_score_2,
					AVG(score_3) AS total_score_3,
					AVG(score_1 + score_2 + score_3) / 3 AS total_score
				FROM users
				LEFT JOIN game ON game.user_id = users.id
				LEFT JOIN game_scores ON game_scores.game_id = game.id
				WHERE users.ten IS NOT NULL AND task = ? AND users.current_program = ?
				GROUP BY users.ten
				ORDER BY total_score DESC, id
				LIMIT 50
			`, { model: models.User, replacements: [taskId, program] })
		}

		// console.log('result', JSON.stringify(result))

		const users = result ? result.filter(u => u.name) : []
		this.body = JSON.stringify({ users })
		// let where = {}
		// let type = null
		// let _offset = Number(offset) || 0
		// let _limit = Number(limit) || 50
		// let _order = this.query.order !== 'undefined' ? this.query.order : null
		//
		// if (category) {
		// 	if (category === 'polki') {
		// 		where = {
		// 		$and: [{
		// 					polk_leader: true,
		// 				},
		// 				{
		// 					current_program: program
		// 				}]
		// 		}
		// 		type = 'polk'
		// 	}
		// 	if (category === 'hundreds') {
		// 		where = {
		// 			$and: [{
		// 			hundred_leader: true,
		// 		},
		// 		{
		// 			current_program: program
		// 		}]
		// 		}
		// 		type = 'hundred'
		// 	}
		// 	if (category === 'tens') {
		// 		where = {
		// 			$and: [{
		// 			ten_leader: true,
		// 		},
		// 		{
		// 			current_program: program
		// 		}]
		// 		}
		// 		type = 'ten'
		// 	}
		// 	if (category === 'couches') {
		// 		where = {
		// 			$and: [{
		// 			couch: true,
		// 		},
		// 		{
		// 			current_program: program
		// 		}]
		// 		}
		// 		type = 'couch'
		// 	}
		// 	if (category === 'hundred_leader') {
		// 		where = {
		// 			$or: [{
		// 				polk: this.session.user
		// 			}, {
		// 				polk: null
		// 			}]
		// 		}
		// 	}
		// 	if (category === 'ten_leader') {
		// 		where = {
		// 			$or: [{
		// 				hundred: this.session.user
		// 			}, {
		// 				hundred: null
		// 			}]
		// 		}
		// 	}
		//
		// 	if (category === 'all' && program) {
		// 		where = {
		// 			current_program: program
		// 		}
		// 	}
		// }
		//
		// if (ten) {
		// 	where = {ten}
		//
		// }
		//
		// if (hundred) {
		// 	where = {ten_leader: true, hundred}
		// 	type = 'ten'
		// }
		//
		// if (polk) {
		// 	where = {hundred_leader:true, polk}
		// 	type = 'hundred'
		// }
		//
		// if (couch_group) {
		// 	where = {couch_group}
		//
		// }
		//
		// if (search) {
		// 	where = Sequelize.where(
		// 		Sequelize.fn('concat', Sequelize.col('first_name'), ' ', Sequelize.col('last_name')),
		// 		{
		// 			$like: `%${search}%`
		// 		}
		// 	)
		// 	_limit = null
		// 	_offset = 0
		// }
		// const groupsInclude = {
		// 	model: models.Group,
		// 	where: {
		// 		type: type
		// 	},
		// 	required: false,
		// 	attributes: ['money', 'total_score']
		// }
		// let order
		//
		//
		// if (_order) {
		// 	order = [_order, 'DESC']
		// }
		//
		// let users
		//
		// if (category == 'all') {
		//
		// 	users = yield models.Game.findAll({
		//
		// 	attributes: ['total_score'],
		//
		// 	include: [{model: models.User,
		// 		attributes: [
		// 		'id',
		// 		'name',
		// 		'first_name',
		// 		'last_name',
		// 		'ten',
		// 		'hundred',
		// 		'polk',
		// 		'ten_leader',
		// 		'hundred_leader',
		// 		'polk_leader',
		// 		'money_total',
		// 		'approved_money',
		// 		'volunteer',
		// 		'current_program'
		// 	],
		// 	include: [groupsInclude],
		// 	where
		//
		// 	}],
		// 	// order: [order],
		// 	// offset: _offset,
		// 	// limit: _limit
		// 	limit: 50,
		// 	order: [['total_score', 'DESC']],
		//
		// })
		// } else {
		//
		// 	users = yield models.Group.findAll({
		//
		// 	attributes: ['total_score'],
		//
		// 	include: [{model: models.User,
		// 		attributes: [
		// 		'id',
		// 		'name',
		// 		'first_name',
		// 		'last_name',
		// 		'ten',
		// 		'hundred',
		// 		'polk',
		// 		'ten_leader',
		// 		'hundred_leader',
		// 		'polk_leader',
		// 		'money_total',
		// 		'approved_money',
		// 		'volunteer',
		// 		'current_program'
		// 	],
		// 	include: [groupsInclude],
		// 	where
		// 	}],
		// 	where: {total_score: { $ne: null } },
		// 	// order: [order],
		// 	// offset: _offset,
		// 	// limit: _limit
		// 	limit: 50,
		// 	order: [['total_score', 'DESC']]
		//
		// })
		//
		//
		//
		// }
		// this.body = JSON.stringify({users})
	})


	router.post('/get_ten_by_name', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;
		const params = this.request.body;
		const {csrf, name} = typeof(params) === 'string' ? JSON.parse(params) : params;
		//if (!checkCSRF(this, csrf)) return;

		const {ten} = yield models.User.findOne({
			attributes: ['ten'],
			where: {
				name
			}
		})

		let users = []
		if (ten) {
			users = yield models.User.findAll({
				attributes: [
					'id',
					'name',
					'first_name',
					'last_name',
					'ten',
					'hundred',
					'polk',
					'ten_leader',
					'hundred_leader',
					'polk_leader',
					'money_total',
					'approved_money'
				],
				where: {ten},
				order: [
					['money_total', 'DESC']
				],
				limit: 50
			})
		}
		this.body = JSON.stringify({users})
	})


	router.post('/get_id_by_name', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;
		const params = this.request.body;
		const {
			csrf,
			email
			// password

		} = typeof(params) === 'string' ? JSON.parse(params) : params;
		//  if (!checkCSRF(this, csrf)) return;

		try {
			//if (!emailRegex.test(email.toLowerCase())) throw new Error('not valid email: ' + email);
			// TODO: limit by 1/min/ip

			//const getBMtoken = yield getBMAccessToken(email, password);


			let getBMProg = ''

			// if (getBMtoken) {

			getBMProg = yield models.User.findOne({
				attributes: [
					'id'
				],
				where: {
					name: esc(email)
				}

			})

			// }


			this.body = JSON.stringify({
				status: 'ok',
				id: getBMProg
			});


		} catch (error) {
			console.error('Error in /get_id_by_name api call', this.session.uid, error);
			this.body = JSON.stringify({
				error: error.message
			});
			this.status = 500;
		}
		// recordWebEvent(this, 'api/user_hierarchy', email);
	});


	router.post('/get_group_by_name', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;
		const params = this.request.body;
		const {csrf, name} = typeof(params) === 'string' ? JSON.parse(params) : params;
		//if (!checkCSRF(this, csrf)) return;

		const {couch_group} = yield models.User.findOne({
			attributes: ['couch_group'],
			where: {
				name
			}
		})

		let users = []
		if (couch_group) {
			users = yield models.User.findAll({
				attributes: [
					'id',
					'name',
					'first_name',
					'last_name',
					'ten',
					'hundred',
					'polk',
					'ten_leader',
					'hundred_leader',
					'polk_leader',
					'money_total',
					'approved_money'
				],
				where: {
					couch_group
				},
				order: [
					['money_total', 'DESC']
				],
				limit: 50
			})
		}
		this.body = JSON.stringify({users})
	})


	router.get('/usersCount', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;
		const {category, ten, hundred, polk, couch_group, search, offsetVal} = this.query
		let where = {}


		if (category) {
			if (category === 'polki') {
				where = {
					polk_leader: true
				}
			}
			if (category === 'hundreds') {
				where = {
					hundred_leader: true
				}
			}
			if (category === 'tens') {
				where = {
					ten_leader: true
				}
			}
			if (category === 'couches') {
				where = {
					couch: true
				}
			}
		}

		if (ten) {
			where = {ten}
		}

		if (hundred) {
			where = {hundred}
		}

		if (polk) {
			where = {polk}
		}

		if (couch_group) {
			where = {couch_group}
		}


		if (search) {
			where = {
				$or: [{
					first_name: {
						$like: `%${search}%`
					}
				}, {
					last_name: {
						$like: `%${search}%`
					}
				}]
			}
		}


		const count = yield models.User.count({
			where
		})
		this.body = JSON.stringify({count})
	})


	router.post('/upload', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;
		console.log('-- /upload -->', this.session.uid, this.session.user);

		const s3 = new AWS.S3();

		try {
			const data = this.request.body
			const {fields: {type}} = this.request.body
			const {file}  = this.request.body.files
			const fileData = yield pify(fs.readFile)(file.path)
			const uploadParams = {
				Bucket: 'bm-platform',
				Key: `${shortid.generate()}-${file.name}`,
				Body: fileData,
				ContentType: file.type
			}
			console.log('==== START UPLOAD ==== ')
			const uploadedFile = yield s3.upload(uploadParams).promise()
			console.log(uploadedFile)
			console.log('==== FINISH UPLOAD ==== ')
			this.body = JSON.stringify({
				url: uploadedFile.Location,
				key: file.name
			})
		} catch (error) {
			console.error('Error in /upload api call', this.session.uid, error.toString());
			this.body = JSON.stringify({
				error: error.message
			});
			this.status = 500;
		}
	})

	router.post('/delete_from_s3', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return;
		console.log('-- /delete_from_s3 -->', this.session.uid, this.session.user);

		const params = this.request.body;
		const {csrf, key} = typeof(params) === 'string' ? JSON.parse(params) : params;

		const s3 = new AWS.S3();

		try {
			const deleteResult = yield s3.deleteObject({
				Bucket: 'bm-platform',
				Key: key
			}).promise()
			console.log(deleteResult)
			this.status = 200;
		} catch (error) {
			console.error('Error in /delete_from_s3 api call', this.session.uid, error.toString());
			this.body = JSON.stringify({
				error: error.message
			});
			this.status = 500;
		}

	})

	router.put('/users/:id', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return
		const data = this.request.body
		const userId = this.params.id
		const {csrf, payload} = typeof(data) === 'string' ? JSON.parse(data) : data
		console.log(`-- /users/${userId} -->`, this.session.uid, this.session.user)

		try {
			if (!this.session.user) {
				throw new Error('Access denied')
			}

			const u = yield models.User.findOne({
				attributes: ['volunteer'],
				where: {
					id: this.session.user
				}
			})

			if (!u.volunteer) {
				throw new Error('Access denied')
			}

			yield models.User.update(payload, {
				where: {id: userId}
			})
			this.body = JSON.stringify({
				status: 'ok'
			})
		} catch (error) {
			console.error(`Error in /users/${userId} api call`, this.session.uid, error.toString())
			this.body = JSON.stringify({
				error: error.message
			})
			this.status = 500
		}
	})

	router.put('/users/ten_choosing/:id', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return
		const data = this.request.body
		const userId = this.params.id
		const {csrf, payload} = typeof(data) === 'string' ? JSON.parse(data) : data
		console.log(`-- /users/ten_choosing:${userId} -->`, this.session.uid, this.session.user)

		try {
			if (!this.session.user) {
				throw new Error('Access denied')
			}

			const u = yield models.User.findOne({
				attributes: ['hundred', 'polk'],
				where: {
					id: payload.ten
				}
			})

			yield models.User.update({ten: payload.ten, polk: u.polk, hundred: u.hundred}, {
				where: {id: userId}
			})
			this.body = JSON.stringify({
				status: 'ok'
			})
		} catch (error) {
			console.error(`Error in /users/ten_choosing:${userId} api call`, this.session.uid, error.toString())
			this.body = JSON.stringify({
				error: error.message
			})
			this.status = 500
		}
	})


	router.post('/users/set_hundred_leader', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return
		const data = this.request.body
		const {csrf, userId, value} = typeof(data) === 'string' ? JSON.parse(data) : data
		console.log(`-- /users/set_hundred_leader -->`, this.session.uid, this.session.user)


		let polk;
		let hundred;

		if(!value) {

			polk = null;
			hundred = null;
		}

		try {
			if (!this.session.user) {
				throw new Error('Access denied')
			}

			const u = yield models.User.findOne({
				attributes: ['id', 'polk_leader'],
				where: {
					id: this.session.user
				}
			})

			if (!u.polk_leader) {
				throw new Error('Access denied')
			}

			yield models.User.update({
				hundred_leader: value,
				hundred: value ? userId : hundred,
				polk: value ? u.id : polk
			}, {
				where: {id: userId}
			})

			this.body = JSON.stringify({
				status: 'ok'
			})
		} catch (error) {
			console.error(`Error in /users/set_hundred_leader api call`, this.session.uid, error.toString())
			this.body = JSON.stringify({
				error: error.message
			})
			this.status = 500
		}
	})

	router.post('/users/set_ten_leader', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return
		const data = this.request.body
		const {csrf, userId, value} = typeof(data) === 'string' ? JSON.parse(data) : data
		console.log(`-- /users/set_ten_leader -->`, this.session.uid, this.session.user)

		let ten;
		let polk;
		let hundred;

		if(!value) {
			ten = null;
			polk = null;
			hundred = null;
		}

		try {
			if (!this.session.user) {
				throw new Error('Access denied')
			}

			const u = yield models.User.findOne({
				attributes: ['id', 'hundred_leader', 'polk'],
				where: {
					id: this.session.user
				}
			})

			if (!u.hundred_leader) {
				throw new Error('Access denied')
			}

			yield models.User.update({
				ten_leader: value,
				ten: value ? userId : ten,
				polk: value ? u.polk : polk,
				hundred: value ? u.id : hundred
			}, {
				where: {id: userId}
			})

			this.body = JSON.stringify({
				status: 'ok'
			})
		} catch (error) {
			console.error(`Error in /users/set_ten_leader api call`, this.session.uid, error.toString())
			this.body = JSON.stringify({
				error: error.message
			})
			this.status = 500
		}
	})

	router.post('/users/set_my_ten', koaBody, function*() {
		if (rateLimitReq(this, this.req)) return
		const data = this.request.body
		const {csrf, userId, value} = typeof(data) === 'string' ? JSON.parse(data) : data
		console.log(`-- /users/set_my_ten -->`, this.session.uid, this.session.user)

		let ten;
		let polk;
		let hundred;

		let myID = this.session.user


		if(!value) {
			ten = null;
			polk = null;
			hundred = null;

		}

		try {
			if (!myID) {
				throw new Error('Access denied')
			}

			const u = yield models.User.findOne({
				attributes: ['id', 'hundred', 'polk'],
				where: {
					id: userId
				}
			})

			//console.log('USER ID MY TEN:', this.session.user)
			yield models.User.update({
				ten: value ? userId : ten,
				hundred: value ? u.hundred : hundred,
				polk: value ? u.polk : polk
			}, {
				where: {id: myID}
			})

			this.body = JSON.stringify({
				status: 'ok'
			})
		} catch (error) {
			console.error(`Error in /users/set_my_ten api call`, this.session.uid, error.toString())
			this.body = JSON.stringify({
				error: error.message
			})
			this.status = 500
		}
	})

	router.get('/users/choose_search', koaBody, function* () {
		if (rateLimitReq(this, this.req)) return
		const {q, group} = this.query

		let g
		if (group === 'hundred') g = 'polk'
		if (group === 'ten') g = 'hundred'

		let where = {
			$and: [
				Sequelize.where(
					Sequelize.fn('concat', Sequelize.col('first_name'), ' ', Sequelize.col('last_name')),
					{
						$like: `%${q}%`
					}
				),
				{
					$or: [{
						[g]: this.session.user
					}, {
						[g]: null
					}]
				}
			]
		}

		if (group === 'all_ten_leaders') {
			where = {
				$and: [
					Sequelize.where(
						Sequelize.fn('concat', Sequelize.col('first_name'), ' ', Sequelize.col('last_name')),
						{
							$like: `%${q}%`
						}
					),
					{
						'ten_leader': true
					}
				]
			}
		}

		const users = yield models.User.findAll({
			attributes: [
				'id',
				'name',
				'first_name',
				'last_name',
				'ten',
				'hundred',
				'polk',
				'ten_leader',
				'hundred_leader',
				'polk_leader',
				'money_total',
				'approved_money',
				'volunteer'
			],
			where
		})

		this.body = JSON.stringify({users})
	})

	router.post('/user/update_program', koaBody, function* () {
		if (rateLimitReq(this, this.req)) return
		const params = this.request.body
		const {csrf, current_program} = typeof(params) === 'string' ? JSON.parse(params) : params
		//if (!checkCSRF(this, csrf)) return;

    try {
      const user = yield models.User.findOne({
        attributes: ['id','current_program'],
        where: {
          id: this.session.user
        }
      })
      user.current_program = current_program
      yield user.save()
    } catch (error) {
			console.error('Error in /user/update_program api call', this.session.uid, error.toString())
			this.body = JSON.stringify({
				error: error.message
			})
			this.status = 500
		}
	})

	router.get('/last_checked_reply', koaBody, function* () {
		try {
			const permlink = yield models.TaskReply.findOne({
				attributes: ['permlink'],
				where: {
					$or: [{
						status: 1
					}, {
						status: 2
					}]
				},
				order: [
					['created', 'DESC']
				]
			})

			this.body = JSON.stringify({
				permlink
			})
		} catch (error) {
			console.error('Error in /task_replies api call', this.session.uid, error.toString())
			this.body = JSON.stringify({
				error: error.message
			})
			this.status = 500
		}
	})

	router.post('/reply/status', koaBody, function* () {
		if (rateLimitReq(this, this.req)) return
		const params = this.request.body
		const {csrf, url} = typeof(params) === 'string' ? JSON.parse(params) : params
		//if (!checkCSRF(this, csrf)) return;
		try {
			const reply = yield models.TaskReply.findOne({
        attributes: ['id', 'status'],
				where: {
					url
				}
			})

			this.body = JSON.stringify({
				status: reply ? reply.status : null
			})
		} catch (error) {
			console.error('Error in /reply/status api call', this.session.uid, error.toString())
			this.body = JSON.stringify({
				error: error.message
			})
			this.status = 500
		}
	})

	router.post('/reply/update', koaBody, function* () {
    if (rateLimitReq(this, this.req)) return
    const params = this.request.body
    const {csrf, payload} = typeof(params) === 'string' ? JSON.parse(params) : params
    //if (!checkCSRF(this, csrf)) return;
		try {
			if (!this.session.user) throw new Error('access denied')

			const u = yield models.User.findOne({
				where: {
					id: this.session.user
				}
			})

			if (!u.volunteer) {
				throw new Error('access denied')
			}

			const reply = yield models.TaskReply.findOne({
        attributes: ['id'],
				where: {
					url: payload.url
				}
			})

      if (reply) {
        yield reply.update({
          ...payload,
          volunteer: this.session.user
        })
      } else {
        yield models.TaskReply.create({
          ...payload,
          volunteer: this.session.user
        })
      }

			this.body = JSON.stringify({
				ok: true
			})
		} catch (error) {
			console.error('Error in /reply/update api call', this.session.uid, error.toString())
			this.body = JSON.stringify({
				error: error.message
			})
			this.status = 500
		}
	})

  router.post('/reply/update_status', koaBody, function* () {
    if (rateLimitReq(this, this.req)) return
    const params = this.request.body
    const {csrf, payload} = typeof(params) === 'string' ? JSON.parse(params) : params
    //if (!checkCSRF(this, csrf)) return;
    try {
      const u = yield models.User.findOne({
        where: {
          id: this.session.user
        }
      })

      const reply = yield models.TaskReply.findOne({
        attributes: ['id'],
        where: {
          url: payload.url
        }
      })

      if (reply) {
        yield reply.update({
          ...payload
        })
      } else {
        yield models.TaskReply.create({
          ...payload
        })
      }

      this.body = JSON.stringify({
        ok: true
      })
    } catch (error) {
      console.error('Error in /reply/update_status api call', this.session.uid, error.toString())
      this.body = JSON.stringify({
        error: error.message
      })
      this.status = 500
    }
  })

  router.get('/game', koaBody, function* () {
    if (rateLimitReq(this, this.req)) return

    try {
      if (!this.session.user) {
        throw new Error('Access denied')
      }

      const [task] = yield sequelize.query('SELECT value FROM settings WHERE type = "task" LIMIT 1')
      const taskId = JSON.parse(JSON.stringify(task))[0].value
      const game = yield models.Game.findOne({
        attributes: ['id', 'body', 'money'],
        where: {
          user_id: this.session.user,
          task: taskId
        },
				include: [{
					model: models.GameScore,
					attributes: ['id', 'score_1', 'score_2', 'score_3', 'comment'],
					include: [{
						model: models.User,
						attributes: ['id', 'name']
					}]
				}]
      })

      if (game) {
				const score_1s = map(prop('score_1'), game.GameScores)
				const total_score_1 = divide(
					reduce((sum, x) => sum + x, 0, filter(negate(isNil), score_1s)),
					size(filter(negate(isNil), score_1s))
				)

				const score_2s = map(prop('score_2'), game.GameScores)
				const total_score_2 = divide(
					reduce((sum, x) => sum + x, 0, filter(negate(isNil), score_2s)),
					size(filter(negate(isNil), score_2s))
				)

				const score_3s = map(prop('score_3'), game.GameScores)
				const total_score_3 = divide(
					reduce((sum, x) => sum + x, 0, filter(negate(isNil), score_3s)),
					size(filter(negate(isNil), score_3s))
				)

        this.body = JSON.stringify({
          content: game.body,
					scores: game.GameScores,
					money: game.money,
					total_score_1,
					total_score_2,
					total_score_3
        })
      } else {
        this.body = JSON.stringify({
          content: null
        })
      }

    } catch (error) {
      console.error('Error in GET /game api call', this.session.user, error.toString())
      this.body = JSON.stringify({
        error: error.message
      })
      this.status = 500
    }
  })

  router.post('/game', koaBody, function* () {
    if (rateLimitReq(this, this.req)) return
    const params = this.request.body
    const {csrf, body, money, total_score_1, total_score_2, total_score_3} = typeof(params) === 'string' ? JSON.parse(params) : params
    // if (!checkCSRF(this, csrf)) return;

    const total_score = (total_score_1 + total_score_2 + total_score_3) / 3

    try {
      if (!this.session.user) {
        throw new Error('Access denied')
      }

      const [task] = yield sequelize.query('SELECT value FROM settings WHERE type = "task" LIMIT 1')
      const taskId = JSON.parse(JSON.stringify(task))[0].value

      const game = yield models.Game.findOne({
        where: {
          user_id: this.session.user,
          task: taskId
        }
      })

      if (game) {
        game.body = body
        game.money = money
				if (total_score_1) {
					game.total_score_1 = total_score_1
				}
				if (total_score_2) {
					game.total_score_2 = total_score_2
				}
				if (total_score_3) {
					game.total_score_3 = total_score_3
				}
				if (total_score) {
					game.total_score = total_score
				}
        yield game.save()
      } else {
        yield models.Game.create({
          user_id: this.session.user,
          body,
          money,
          total_score_1,
          total_score_2,
          total_score_3,
          total_score: total_score || null,
          task: taskId
        })
      }

      this.status = 200

    } catch (error) {
      console.error('Error in POST /game api call', this.session.user, error.toString())
      this.body = JSON.stringify({
        error: error.message
      })
      this.status = 500
    }
  })

	router.post('/feedback', koaBody, function* () {
		if (rateLimitReq(this, this.req)) return
		const params = this.request.body
		const {csrf, body, score_1, score_2, score_3} = typeof(params) === 'string' ? JSON.parse(params) : params
		// if (!checkCSRF(this, csrf)) return;

		try {
			if (!this.session.user) {
				throw new Error('Access denied')
			}

			let total_score = divide(
				reduce((sum, x) => sum + x, 0, filter(negate(isNil), [score_1, score_2, score_3])),
				size(filter(negate(isNil), [score_1, score_2, score_3]))
			)

			if (!score_1 && !score_2 && !score_3)  {total_score = null}

			console.log('Total Score:', total_score)

			yield models.Feedback.create({
				user_id: this.session.user,
				body,
				score_1,
				score_2,
				score_3,
				total_score
			})

			let [links] = yield sequelize.query('SELECT value FROM settings WHERE type = "links" LIMIT 1')
			links = JSON.parse(JSON.stringify(links))[0] ? JSON.parse(JSON.stringify(links))[0].value : ''

			this.body = JSON.stringify({
				links
			})

		} catch (error) {
			console.error('Error in POST /feedback api call', this.session.user, error.toString())
			this.body = JSON.stringify({
				error: error.message
			})
			this.status = 500
		}
	})

	router.get('/game/byuser/:id', koaBody, function* () {
		if (rateLimitReq(this, this.req)) return
		// if (!checkCSRF(this, csrf)) return;

		const [task] = yield sequelize.query('SELECT value FROM settings WHERE type = "task" LIMIT 1')
		const taskId = JSON.parse(JSON.stringify(task))[0].value

     const game = yield models.Game.findOne({
        attributes: ['id', 'body', 'money'],
        where: {
          task: taskId
        },
				include: [{
					model: models.GameScore,
					attributes: ['id', 'score_1', 'score_2', 'score_3', 'comment'],
					where: {
						user_id: this.session.user
					},
					required: false
				}, {
					model: models.User,
					attributes: ['id', 'name'],
					where: {
						id: this.params.id
					}
				}]
      })

    // const user = yield models.User.findOne({
    //   attributes: ['name'],
    //   where: {
    //     id: this.params.id
    //   },
    //   include: [{
    //     model: models.Game,
				// where: {
				// 	task: taskId
				// }
    //   }]
    // })

    // const posts = user.Games.map(post => ({ ...JSON.parse(JSON.stringify(post)), author: user.name }))

    this.body = JSON.stringify({
      posts: game ? [game] : []
    })

	})

	router.get('/game/byten/:id', koaBody, function* () {
		if (rateLimitReq(this, this.req)) return
		// if (!checkCSRF(this, csrf)) return;


		const [task] = yield sequelize.query('SELECT value FROM settings WHERE type = "task" LIMIT 1')
		const taskId = JSON.parse(JSON.stringify(task))[0].value

     const posts = yield models.Game.findAll({
        attributes: ['id', 'body', 'money'],
        where: {
          task: taskId
        },
				include: [{
					model: models.GameScore,
					attributes: ['id', 'score_1', 'score_2', 'score_3', 'comment'],
					where: {
						user_id: this.session.user
					},
					required: false
				}, {
					model: models.User,
					attributes: ['id', 'name'],
					where: {
						ten: this.params.id
					}
				}]
      })

    this.body = JSON.stringify({
      posts
    })
  })


	router.get('/game/randomten/', koaBody, function* () {
		if (rateLimitReq(this, this.req)) return
		// if (!checkCSRF(this, csrf)) return;

    const users = yield models.User.findAll({
      attributes: ['name'],

      include: [{
        model: models.Game,

        where: { score_1_other_ten_count:
        			 { $lt : 3 }
    		   }
      }],
      limit: 10,
      order: [
    		Sequelize.fn( 'RAND' )
  			]
    })
    const posts = users.map(user => {
      return { ...JSON.parse(JSON.stringify(user.Games))[0], author: user.name }
    })

    this.body = JSON.stringify({
      posts
    })
  })


  router.put('/game/update_score', koaBody, function* () {
    if (rateLimitReq(this, this.req)) return
    const params = this.request.body
    const {csrf, id, score_1, score_2, score_3, comment} = typeof(params) === 'string' ? JSON.parse(params) : params

    // const checked_user = yield models.User.findOne({
    //   attributes: ['ten'],
    //   where: {
    //     id: this.session.user
    //   }
    // })

    // const game = yield models.Game.findOne({
    //   where: {
    //     id
    //   }
    // })

    // const user = yield models.User.findOne({
    //   attributes: ['ten'],
    //   where: {
    //     id: game.user_id
    //   }
    // })

		// console.log('Udate score', {
		// 	id,
		// 	score_1,
		// 	score_2,
		// 	score_3,
		// 	comment
		// })

	const score = yield models.GameScore.findOne({
		where: {
			UserId: this.session.user,
			GameId: id
		}
	})

	if (score) {
		score.score_1 = score_1
		score.score_2 = score_2
		score.score_3 = score_3
		score.comment = comment
		yield score.save()
	} else {
    yield models.GameScore.create({
			UserId: this.session.user,
			GameId: id,
			score_1,
			score_2,
			score_3,
			comment
		})
	}

		return

    if (user.ten === checked_user.ten) {
      game.score_1_my_ten = Number(game.score_1_my_ten || 0) + Number(score_1)
      game.score_1_my_ten_count = Number(game.score_1_my_ten_count || 0) + 1

      game.score_2_my_ten = Number(game.score_2_my_ten || 0) + Number(score_2)
      game.score_2_my_ten_count = Number(game.score_2_my_ten_count || 0) + 1

      game.score_3_my_ten = Number(game.score_3_my_ten || 0) + Number(score_3)
      game.score_3_my_ten_count = Number(game.score_3_my_ten_count || 0) + 1

      yield game.save()
    } else {
      game.score_1_other_ten = Number(game.score_1_other_ten || 0) + Number(score_1)
      game.score_1_other_ten_count = Number(game.score_1_other_ten_count || 0) + 1

      game.score_2_other_ten = Number(game.score_2_other_ten || 0) + Number(score_2)
      game.score_2_other_ten_count = Number(game.score_2_other_ten_count || 0) + 1

      game.score_3_other_ten = Number(game.score_3_other_ten || 0) + Number(score_3)
      game.score_3_other_ten_count = Number(game.score_3_other_ten_count || 0) + 1

      yield game.save()
    }

    // Score 1 Interesting
    if (game.score_1_my_ten_count > 0) {
      game.total_score_1 = (game.score_1_my_ten / game.score_1_my_ten_count)
    }

     if (game.score_1_other_ten_count > 0) {
      game.total_score_1 = (game.score_1_other_ten / game.score_1_other_ten_count)
    }

    if (game.score_1_my_ten_count > 0 && game.score_1_other_ten_count > 0) {
      game.total_score_1 = ((game.score_1_my_ten / game.score_1_my_ten_count) + (game.score_1_other_ten / game.score_1_other_ten_count))/2
    }

    // Score 2 Prosto

    if (game.score_2_my_ten_count > 0) {
      game.total_score_2 = (game.score_2_my_ten / game.score_2_my_ten_count)
    }

     if (game.score_2_other_ten_count > 0) {
      game.total_score_2 = (game.score_2_other_ten / game.score_2_other_ten_count)
    }

    if (game.score_2_my_ten_count > 0 && game.score_2_other_ten_count > 0) {
      game.total_score_2 = ((game.score_2_my_ten / game.score_2_my_ten_count) + (game.score_2_other_ten / game.score_2_other_ten_count))/2
    }

    // Score 3 Ponyatno - Enisey-14

    if (game.score_3_my_ten_count > 0) {
      game.total_score_3 = (game.score_3_my_ten / game.score_3_my_ten_count)
    }

     if (game.score_3_other_ten_count > 0) {
      game.total_score_3 = (game.score_3_other_ten / game.score_3_other_ten_count)
    }

    if (game.score_3_my_ten_count > 0 && game.score_3_other_ten_count > 0) {
      game.total_score_3 = ((game.score_3_my_ten / game.score_3_my_ten_count) + (game.score_3_other_ten / game.score_3_other_ten_count))/2
    }

    yield game.save() // Enisey-14 Saving Information

    game.total_score = 0;

    if (game.total_score_1) {
      game.total_score = game.total_score_1
    }

    if (game.total_score_1 && game.total_score_2) {
    }

    if (game.total_score_1 && game.total_score_2 && game.total_score_3) {
      game.total_score = (game.total_score_1 + game.total_score_2 + game.total_score_3) / 3
    }

    yield game.save() // Enisey-14 Saving Final Information
  })

	router.get('/feedback/results/nps', koaBody, function* () {
		const { event, city, day } = this.query

    let whereCity = {}

    if (city && city !== 'all') {
      whereCity = { program_city: decodeURI(city) }
    }

    if (city === 'other') {
      whereCity = { program_city: null }
    }

    let whereDay = false

    if (day && day !== 'all') {
      whereDay = true
    }

		const replies = yield models.Feedback.findAll({
			attributes: [
				'id',
				'user_id',
				'body',
				'created_at',
				'score_1',
				'score_2',
				'score_3',
				'total_score',
			],
      where: whereDay ? {
        created_at: {
          $between: [addHours(new Date(day), 15), addDays(addHours(new Date(day), 15), 7)]
        }
      } : null,
			include: [{
				model: models.User,
				where: Object.assign({}, {
					id: Sequelize.col('user_id'),
					current_program: event
				}, whereCity),
				attributes: ['current_program']
			}]
	 })

	 const total_count = replies.length

	 const a1_count = replies.filter(x => x.score_1 >= 9).length
	 const b1_count = replies.filter(x => x.score_1 > 0 && x.score_1 <= 6).length

	 const a1_percent = (a1_count * 100) / total_count
	 const b1_percent = (b1_count * 100) / total_count

	 const nps1 = a1_percent - b1_percent

	 const a2_count = replies.filter(x => x.score_2 >= 9).length
	 const b2_count = replies.filter(x => x.score_2 > 0 && x.score_2 <= 6).length

	 const a2_percent = (a2_count * 100) / total_count
	 const b2_percent = (b2_count * 100) / total_count

	 const nps2 = a2_percent - b2_percent

	 const a3_count = replies.filter(x => x.score_3 >= 9).length
	 const b3_count = replies.filter(x => x.score_3 > 0 && x.score_3 <= 6).length

	 const a3_percent = (a3_count * 100) / total_count
	 const b3_percent = (b3_count * 100) / total_count

	 const nps3 = a3_percent - b3_percent

	 const a_total_count = replies.filter(x => x.total_score >= 9).length
	 const b_total_count = replies.filter(x => x.total_score > 0 && x.total_score <= 6).length

	 const a_total_percent = (a_total_count * 100) / total_count
	 const b_total_percent = (b_total_count * 100) / total_count

	 const nps = a_total_percent - b_total_percent

	 this.body = JSON.stringify({
		 nps1,
		 nps2,
		 nps3,
		 nps
	 })
	})

	router.get('/feedback/results/replies', koaBody, function* () {
		const { limit, offset, event, city, day } = this.query

    let whereCity = {}

    if (city && city !== 'all') {
      whereCity = { program_city: decodeURI(city) }
    }

    if (city === 'other') {
      whereCity = { program_city: null }
    }

    let whereDay = false

    if (day && day !== 'all') {
      whereDay = true
    }

		const replies = yield models.Feedback.findAndCountAll({
			attributes: [
				'id',
				'user_id',
				'body',
				'created_at',
				'score_1',
				'score_2',
				'score_3',
				'total_score'
			],
      where: whereDay ? {
        created_at: {
          $between: [addHours(new Date(day), 15), addDays(addHours(new Date(day), 15), 7)]
        }
      } : null,
			include: [{
				model: models.User,
        where: Object.assign({}, {
					id: Sequelize.col('user_id'),
					current_program: event
				}, whereCity),
				attributes: ['name']
			}],
			order: [['created_at', 'DESC']],
			limit: Number(limit),
			offset: Number(offset)
	 })

	 this.body = JSON.stringify({
		 replies: replies.rows,
		 count: replies.count
	 })
	})

	router.get('/feedback/results/cities', koaBody, function* () {
		const { event } = this.query

    try {
      const cities = yield sequelize.query(`
				SELECT users.program_city AS name, COUNT(feedback.id) AS count
				FROM feedback
				INNER JOIN users ON feedback.user_id = users.id
				WHERE users.current_program = ?
				GROUP BY users.program_city
			`, { model: models.User, replacements: [event]})

			this.body = JSON.stringify({
				cities: JSON.parse(JSON.stringify(cities))
			})
    }  catch (error) {
			console.error('Error in GET /feedback/results/cities api call', this.session.user, error.toString())
			this.body = JSON.stringify({
				error: error.message
			})
			this.status = 500
		}
	})

  router.get('/feedback/results/days', koaBody, function* () {
    const { event } = this.query

    try {
      const cehdays = yield sequelize.query(`
        SELECT DATE(feedback.created_at) AS created_at
        FROM feedback
        INNER JOIN users ON feedback.user_id = users.id
        WHERE users.current_program = '1'
        GROUP BY DATE(feedback.created_at)
      `, { model: models.Feedback })

      const mzsdays = yield sequelize.query(`
        SELECT DATE(feedback.created_at) AS created_at
        FROM feedback
        INNER JOIN users ON feedback.user_id = users.id
        WHERE users.current_program = '2'
        GROUP BY DATE(feedback.created_at)
      `, { model: models.Feedback })

     this.body = JSON.stringify({
       days: {
         ceh: compose(
           map(date => format(date, 'YYYY-MM-DD')),
           map(prop('created_at'))
         )(JSON.parse(JSON.stringify(cehdays))),
         mzs: compose(
           map(date => format(date, 'YYYY-MM-DD')),
           map(prop('created_at'))
         )(JSON.parse(JSON.stringify(mzsdays)))
       }
     })
    }  catch (error) {
      console.error('Error in GET /feedback/results/cities api call', this.session.user, error.toString())
      this.body = JSON.stringify({
        error: error.message
      })
      this.status = 500
    }
  })

	router.get('/game/get_next_ten_old', koaBody, function* () {
		const { ten } = yield models.User.findOne({
			attributes: ['ten'],
			where: {
				id: this.session.user
			}
		})

		const nextId = yield models.User.min('id', {
			where: {
				id: {
					$gt: ten
				},
				ten_leader: true
			}
		})

		const firstTen = yield models.User.findOne({
			attributes: ['ten'],
			where: {
				ten_leader: true
			}
		})

		const nextTen = nextId || firstTen.ten

		console.log('current ten id: ', ten)
		console.log('next ten id: ', nextTen)

		this.body = JSON.stringify({
			tenId: nextTen
		})
	})


	router.get('/game/get_next_ten', koaBody, function* () {
		let res = yield models.Game.findOne({
			attributes: [],

     		 include: [{
       		 model: models.User,
     		attributes: ['ten'],


     		 }],
     		where: { score_1_other_ten_count:  null },

      		order: [
    		Sequelize.fn( 'RAND' )
  			]
		})


		if (!res) {
			res = yield models.Game.findOne({
			attributes: [],

     		 include: [{
       		 model: models.User,
     		attributes: ['ten'],


     		 }],


      		order: [
    		Sequelize.fn( 'RAND' )
  			]
		})

		if (!res) {
			throw new Error("There's no repies yet");
		}



		}


		//console.log('RESULT', JSON.stringify(res))

		this.body = JSON.stringify({
			tenId: res ? res.User.ten : null
		})
	})

	router.post('/plan', koaBody, function* () {
		if (rateLimitReq(this, this.req)) return
		const params = this.request.body
		const {csrf, plan, wordPrice, id} = typeof(params) === 'string' ? JSON.parse(params) : params
		//if (!checkCSRF(this, csrf)) return;

		try {
			yield models.User.update({
				plan,
				word_price: wordPrice
			}, {
				where: {
					id: id || this.session.user
				}
			})
			this.status = 200
		} catch (error) {
			console.error('Error in POST /plan api call', this.session.user, error.toString())
			this.body = JSON.stringify({
				error: error.message
			})
			this.status = 500
		}
	})

	router.get('/plan', koaBody, function* () {
		if (rateLimitReq(this, this.req)) return

    const id = this.query.id === 'undefined' ? null : this.query.id

		const plan = yield models.User.findOne({
			attributes: ['plan', 'word_price'],
			where: {
				id: id || this.session.user
			}
		})

		this.body = JSON.stringify({
			plan
		})
	})

	router.get('/get_plan_show_status', koaBody, function* () {
		if (rateLimitReq(this, this.req)) return
		const [planShowStatus] = yield sequelize.query(`
			SELECT value FROM settings WHERE type = "plan" LIMIT 1
		`)

		this.body = JSON.stringify({
			planShowStatus: planShowStatus[0] ? JSON.parse(planShowStatus[0].value) : null
		})
	})


	router.get('/content_list', koaBody, function* () {
		let result = yield models.ContentPost.findAll({
			attributes: [  'rating', 'price', 'Post.title' ],
			include: [
				{
					model: models.Post,
					where: {
						id: sequelize.col('post_id')
					},
					include: [
						{
							attributes: [ 'name' ],
							model: models.Tag,
							where: {
								post_id: sequelize.col('Post.id')
							},
							required: false,
							group: [ sequelize.col('Post.Tags.id') ]
						},
						{
							attributes: [ 'name', 'id' ],
							model: models.Program,
							where: { id: this.query.program || 0 }
						}
					]
				}
			]
		})

		this.body = JSON.stringify({
			result
		})
	})

	router.get('/content_list_tags', koaBody, function* () {
		let post_id_array = this.query.ids.split(',')
		let result = yield models.Tag.findAll({
			raw: true,
			attributes: [
				'name',
				[ sequelize.fn('count', 'Tag.id'), 'count' ]
			],
			where: {
				post_id: { $in: post_id_array }
			},
			group: [ 'name' ]
		})

		this.body = JSON.stringify({
			result
		})

	router.get('/get_co_couch', koaBody, function* () {
		if (rateLimitReq(this, this.req)) return

		const id = this.query.id === 'undefined' ? null : this.query.id

		const couch = yield models.User.findOne({
			attributes: ['id', 'name', 'first_name', 'last_name'],
			where: {
				couch: true,
				couch_group: id
			}
		})

    this.body = JSON.stringify({
      couch
    })

	})

}


function* getBMAccessToken(username, password) {
	return fetch('http://api.molodost.bz/oauth/token/', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			client_id: config.bmapi.client_id,
			client_secret: config.bmapi.client_secret,
			grant_type: 'password',
			username: username,
			password: password

		})
	}).then(res => res.json())
}

function* revokeBMAccessToken(token) {
	return fetch('http://api.molodost.bz/oauth/revoke/', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			client_id: config.bmapi.client_id,
			token: token,
			token_type_hint: 'access_token'

		})
	}).then(res => res.json())
}


function* getBMAccessTokenCredentialsOnly() {
	return fetch('http://api.molodost.bz/oauth/token/', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			client_id: config.bmapi.client_id,
			client_secret: config.bmapi.client_secret,
			grant_type: 'client_credentials'
		})
	}).then(res => res.json())
}

function* getBMProgramById(entry_set_id, user_id, access_token) {
	return fetch('http://api.molodost.bz/api/v3/user/entry-set/has-access/?entry_set_id=' + entry_set_id + '&user_id=' + user_id, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': 'Bearer ' + access_token
		}
	}).then(res => res.json())
}

function* getBMSignUp(newemail, newname, lastname, access_token) {


	// newname = toString(newname).replace(/[^A-Za-zА-Яа-яЁё]/g, "")
	// newemail = toString(newemail)
	var form = new FormData();
	form.append('email', newemail);
	form.append('firstname', newname);
	form.append('lastname', lastname);

	return fetch('http://api.molodost.bz/api/v3/auth/register/', {
		method: 'POST',
		headers: {
			'Authorization': 'Bearer ' + access_token

		},
		body: form
	}).then(res => res.json())
}

function* getBMRecovery(newemail, access_token) {


	// newname = toString(newname).replace(/[^A-Za-zА-Яа-яЁё]/g, "")
	// newemail = toString(newemail)


	var FormData = require('form-data');
	var form = new FormData();
	form.append('email', newemail);


	return fetch('http://api.molodost.bz/api/v3/auth/password/restore/', {
		method: 'POST',
		headers: {
			'Authorization': 'Bearer ' + access_token

		},
		body: form
	}).then(res => res.json())
}

function* getBMProgram(event, access_token) {

	return fetch('http://api.molodost.bz/api/v3/request/get-requests/?event_id=' + event, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': 'Bearer ' + access_token
		}

	}).then(res => res.json())
}


function* getBMUserMeta(acces_token) {
	return fetch('http://api.molodost.bz/api/v3/user/me/', {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': 'Bearer ' + acces_token
		}
	}).then(res => res.json()).catch(e => console.log(e))
}

function* isUserAuthOnBM (user, hash, ua) {

  const form = new FormData();
  form.append('user', user);
  form.append('hash', hash);
  form.append('user_agent', ua);
  form.append('grant_type', 'user_hash')

  const { access_token } = yield getBMAccessTokenCredentialsOnly()

  const resp = yield fetch('http://api.molodost.bz/oauth/token/', {
    method: 'POST',
    headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			client_id: config.bmapi.client_id,
			client_secret: config.bmapi.client_secret,
			user: user,
			hash: hash,
			user_agent: ua,
			grant_type: 'user_hash'


		})
  }).then(res => res.json())



  return resp.access_token
}

function* delete_cookie( name ) {
  document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
}

/**
 @arg signingKey {string|PrivateKey} - WIF or PrivateKey object
 */
function* createAccount({
	signingKey,
	fee,
	creator,
	new_account_name,
	json_metadata = '',
	owner,
	active,
	posting,
	memo,
	broadcast = false,
}) {
	const operations = [
		['account_create', {
			fee,
			creator,
			new_account_name,
			json_metadata,
			owner: {
				weight_threshold: 1,
				account_auths: [],
				key_auths: [
					[owner, 1]
				]
			},
			active: {
				weight_threshold: 1,
				account_auths: [],
				key_auths: [
					[active, 1]
				]
			},
			posting: {
				weight_threshold: 1,
				account_auths: [],
				key_auths: [
					[posting, 1]
				]
			},
			memo_key: memo,
		}]
	]
	const tx = yield createTransaction(operations)
	const sx = signTransaction(tx, signingKey)
	if (!broadcast) return signed_transaction.toObject(sx)
	return yield new Promise((resolve, reject) =>
		Apis.broadcastTransaction(sx, () => {
			resolve()
		}).catch(e => {
			reject(e)
		})
	)
}
