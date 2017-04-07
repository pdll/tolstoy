import React, { Component } from 'react'
import { Link } from 'react-router'
import Apis from 'shared/api_client/ApiInstances'
import LoadingIndicator from 'app/components/elements/LoadingIndicator'
import { endsWith } from 'lodash'

const Avatar = ({ picture, link }) => {
  if (!process.env.BROWSER || !picture) {
    return <LoadingIndicator type="circle" inline />
  }
  return (
    <Link to={link}>
      <img src={picture} />
    </Link>
  )
}

class CouchGroup extends Component {
  constructor(props) {
    super(props)
    this.state = {}

    this.getCoCouch = this.getCoCouch.bind(this)
    this.getAccount = this.getAccount.bind(this)
  }

  async componentDidMount() {
    const { picture, occupation } = await this.getAccount(this.props.couch.name)
    this.setState({
      picture,
      occupation
    })
    this.getCoCouch()
  }

  async getCoCouch() {
    const response = await fetch(`/api/v1/get_co_couch?id=${this.props.couch.id}`)
    const { couch } = await response.json()
    if (couch) {
      const { picture, occupation } = await this.getAccount(couch.name)
      this.setState({
        coCouch: Object.assign({}, couch, {
          picture,
          occupation
        }),
      })
    }
  }

  async getAccount(username) {
    const [account] = await Apis.db_api('get_accounts', [username])
    const parsed = JSON.parse(account.json_metadata)
    return {
      picture: parsed.user_image,
      occupation: parsed.occupation
    }
  }

  getPhotoUrl(path) {
    if (endsWith(path, '/null')) {
      return '/images/user.png'
    }
    const proxy = $STM_Config.img_proxy_prefix
    if (proxy) {
      return `${proxy}50x50/${path}`
    }
    return path
  }

  render() {
    return (
      <div>
        <div className="User__wrap">
          <div className="Author__avatar_wrapper">
            <div className="User">
              <Avatar picture={this.getPhotoUrl(this.state.picture)} link={this.props.link} />
            </div>
          </div>
          <span className="Author">
            <span itemProp="author" itemScope itemType="http://schema.org/Person" className="Author__name">
              <Link to={this.props.link}>
                {this.props.couch.first_name} {this.props.couch.last_name} {this.state.coCouch && <span>/ {this.state.coCouch.first_name} {this.state.coCouch.last_name}</span>}
              </Link>
            </span>
          </span>
          <div className="PostSummary__niche">{this.state.occupation || 'Не указана ниша'}</div>
        </div>
        <div className="Rating__money">{this.props.money}</div>
      </div>
    )
  }
}

CouchGroup.propTypes = {
  couch: React.PropTypes.object.isRequired,
  money: React.PropTypes.string.isRequired,
  link: React.PropTypes.string.isRequired
}

export default CouchGroup
