import React, {Component, PropTypes} from 'react';
import {connect} from 'react-redux';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';
import Apis from 'shared/api_client/ApiInstances'
import TimeAgoWrapper from 'app/components/elements/TimeAgoWrapper';
import { Link } from 'react-router';
import { endsWith } from 'lodash'

const {oneOfType, string, object} = PropTypes

const getPhotoUrl = path => {
  if (!path || endsWith(path, '/null') || path === '/images/user.png') {
    return '/images/user.png'
  }
  const proxy = $STM_Config.img_proxy_prefix
  if (proxy) {
    return `${proxy}50x50/${path}`
  }
  return path
}


class User extends Component {
	// you can pass either user object, or username string

	static defaultProps = {
		width: 100,
		height: 100
	}

  constructor(props) {
    super(props)
    this.state = {
      image: null,
      account: null
    }
  }

  async componentDidMount() {
    const account = this.props.account
    let userData
    if (account) {

      if (typeof account != 'object') {
        const [acc] = await Apis.db_api('get_accounts', [account])
        userData = acc
      } else {
        userData = account
      }
      const parsed = JSON.parse(userData.json_metadata)
      if (parsed.user_image) {
        this.setState({
          image: parsed.user_image
        })
      }
    }
  }

    shouldComponentUpdate = shouldComponentUpdate(this, 'User')

    getAccount = () => {
        const {account, postdate} = this.props
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
            return <div className="User">
                        <LoadingIndicator type="circle" inline />
    				</div>;
        }

        let username = account;

		let url
        let userOccupation ='Не указана ниша'
        let fullName = username.name


        let postDateTime


        if (this.props.postdate) postDateTime = <TimeAgoWrapper date={this.props.postdate} className="updated" />

		// try to extract image url from users metaData

         // try to extract image url from users metaData
        try { let parseRes = JSON.parse(account.json_metadata)
            if (parseRes.first_name) fullName =  parseRes.first_name || username.name
            if (parseRes.last_name) fullName = fullName + ' ' + parseRes.last_name

            url = parseRes.user_image || '/images/user.png'

            if (parseRes.occupation) userOccupation =  parseRes.occupation || 'Не указана ниша'

        }
        catch (e) {
            // console.warn(e)
            fullName = username.name
             url = '/images/user.png'
             userOccupation = 'Не указана ниша'
        }

        const nameFromProps = this.props.name
        const linkFromProps = this.props.link

		return 	<div className="User__wrap">

            <div className="Author__avatar_wrapper">
            <div className="User">
                    {process.env.BROWSER ?
                        url ? <Link to={linkFromProps || '/@' + username.name}> <img src={getPhotoUrl(this.state.image)} onError={this.onError} /></Link> : <Link href={'/@' + username.name}><div className="User__defaultAva"></div></Link> :
                        <LoadingIndicator type="circle" inline />}
				</div></div>


                 <span className="Author">
                <span itemProp="author" itemScope itemType="http://schema.org/Person" className="Author__name">
                    <Link to={linkFromProps || '/@' + username.name}>{nameFromProps || fullName}</Link>
                </span>
                {postDateTime}
            </span>



             <div className="PostSummary__niche">{userOccupation}</div>
             </div>



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
)(User)
