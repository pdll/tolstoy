import React, {Component, PropTypes} from 'react';
import {connect} from 'react-redux';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';
import _urls from 'shared/clash/images/urls'
import Apis from 'shared/api_client/ApiInstances'
import { endsWith } from 'lodash'

const {oneOfType, string, object} = PropTypes

const getPhotoUrl = path => {
  if (endsWith(path, '/null')) {
    return '/images/user.png'
  }
  if (path === '/images/user.png') {
    return '/images/user.png'
  }
  const proxy = $STM_Config.img_proxy_prefix
  if (proxy) {
    return `${proxy}50x50/${path}`
  }
  return path
}

class Userpic extends Component {
	// you can pass either user object, or username string

    state = {
        image: null,
        account: null
    }

	static defaultProps = {
		width: 48,
		height: 48
	}

    shouldComponentUpdate = shouldComponentUpdate(this, 'Userpic')

    getAccount = () => {
        const {account} = this.props
        if (typeof account != 'object') {
            Apis.db_api('get_accounts', [account]).then(res => {

                this.setState({account: res[0]})
            });
        }
    }

    onError = () => this.setState({image: '/images/user.png'})

	render() {


		const {props, state} = this
		let {dispatch, ...rest} = props
        const account = state.account || props.account

        // get account from state if proper user object was not provided
        if (typeof account != 'object') {
            this.getAccount()
            return <div className="Userpic">
                        <LoadingIndicator type="circle" inline />
    				</div>;
        }

		let url

		// try to extract image url from users metaData
		try { url = JSON.parse(account.json_metadata).user_image || '/images/user.png' }
		catch (e) {
            // console.warn(e)
            url = '/images/user.png'
        }
		return 	<div className="Userpic">
                    {process.env.BROWSER ?
                        url ? <img src={getPhotoUrl(url)}  onError={this.onError} /> : <div className="Userpic__defaultAva"></div> :
                        <LoadingIndicator type="circle" inline />}
				</div>;
	}
}

export default connect(
	(state, {account, ...restOfProps}) => {

		// you can pass either user object, or username string
		if (typeof account == 'string') {
            const accountFromState = state.global.getIn(['accounts', account]);
            if(accountFromState) account = accountFromState.toJS();
		}

		return { account, ...restOfProps }
	}
)(Userpic)
