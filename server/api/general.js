import koa_router from 'koa-router';
import koa_body from 'koa-body';
import fetch from 'node-fetch';
import models, {esc, escAttrs, Sequelize} from 'db/models';
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
import AWS from 'aws-sdk';
import pify from 'pify';
import fs from 'fs';
import {flatten, map} from 'lodash';
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
          'email'
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
		const {category, ten, hundred, polk, couch_group, search, offset, limit} = this.query
		let where = {}
		let type = null
		let _offset = Number(offset) || 0
		let _limit = Number(limit) || 50
		let _order = this.query.order !== 'undefined' ? this.query.order : null

		if (category) {
			if (category === 'polki') {
				where = {
					polk_leader: true,
				}
				type = 'polk'
			}
			if (category === 'hundreds') {
				where = {
					hundred_leader: true,
				}
				type = 'hundred'
			}
			if (category === 'tens') {
				where = {
					ten_leader: true,
				}
				type = 'ten'
			}
			if (category === 'couches') {
				where = {
					couch: true,
				}
				type = 'couch'
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
		}

		if (ten) {
			where = {ten}
		}

		if (hundred) {
			where = {ten_leader: true, hundred}
		}

		if (polk) {
			where = {hundred_leader:true, polk}
		}

		if (couch_group) {
			where = {couch_group}
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
			where,
			order: [order],
			include: [groupsInclude],
			offset: _offset,
			limit: _limit
		})
		this.body = JSON.stringify({users})
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
