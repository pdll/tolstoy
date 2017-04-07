import React, { Component } from 'react'
import { Link } from 'react-router'
import { connect } from 'react-redux'
import { UserAuthWrapper } from 'redux-auth-wrapper'
import { DropdownButton, MenuItem } from 'react-bootstrap'
import HorizontalSubmenu from 'app/components/elements/HorizontalSubmenu'
import StarRatingComponent from 'react-star-rating-component'

class Content extends Component {
  constructor (props) {
    super(props)

    this.state = {
      tags: [],
      content: []
    }

    this.getTag = this.getTag.bind(this)
    this.getEvent = this.getEvent.bind(this)
  }

  componentDidMount () {
    this.getContent()
  }

  getEvent (props = this.props, type = 'numeric') {
    if (props.params.event === 'ceh') return type === 'numeric' ? '1' : 'ceh'
    if (props.params.event === 'mzs') return type === 'numeric' ? '2' : 'mzs'
    return type === 'numeric' ? '1' : 'ceh'
  }

  getTag (props = this.props) {
    return (props.location && props.location.query) ? props.location.query.tag || 'all' : 'all'
  }

  getContentType (props = this.props) {
    return (props.location && props.location.query) ? props.location.query.type || 'all' : 'all'
  }

  tags = [
    { name: 'Дашкиев', count: 2 },
    { name: 'Смешной тег', count: 15 },
    { name: 'Видео', count: 5 },
    { name: 'Трафик', count: 6 },
    { name: 'Мотивация', count: 3 }
  ]

  types = [
    { name: 'Все', code: 'all' },
    { name: 'Видео', code: 'video' },
    { name: 'Статьи', code: 'articles' },
    { name: 'Презентации', code: 'presentations' }
  ]

  programs = [
    { name: 'ЦЕХ', code: 'ceh', num: 1 },
    { name: 'МЗС', code: 'mzs', num: 2 }
  ]

  getContent () {
    fetch(`/api/v1/content_list?program=1`)
      .then(res => res.json())
      .then(res => {
        this.setState({
          content: res.result
        })        
        let ids = []
        res.result.map(el => ids.push(el.Post.id))
        this.getTags(ids)
      })
      .catch(err => console.warn(err))
  }
  
  getTags (ids) {
    fetch('/api/v1/content_list_tags?ids=' + ids.join(','))
      .then(res => res.json())
      .then(res => {
        this.setState({
          tags: res.result
        })
      })
      .catch(err => console.warn(err))
  }

  render () {
    let { content, tags } = this.state

    return (<div>
      <div className="PostsIndex__left col-md-8 col-sm-12 small-collapse">

        <ul className="HorizontalMenu menu FeedbackResults_menu">
          { this.types.map(el => (
            <li className={this.getContentType() === el.code ? 'active' : ''} key={ 'content-type-' + el.code }>
              <Link to={`/content/${this.getEvent(this.props, 'string')}?type=` + el.code}>{ el.name }</Link>
            </li>
          )) }     
        </ul>

        <div className="Rating__submenu">
          <ul className="HorizontalSubmenu menu">
            { this.programs.map(el => (
              <li className={this.getEvent() == el.num ? 'active' : ''} key={ 'content-program-' + el.code }>
                <Link to={`/content/` + el.code }>{ el.name }</Link>
              </li>
            )) }
          </ul>
        </div>

        <br />

        { (content && content.length) && content.map(el => (
          <div className="PostSummary content-post" key={ 'content-post-' + el.Post.id }>
            <img className="content-post__image" src="" alt={ el.Post.title } />
            <h3>{ el.Post.title }</h3>
            <p>{ el.Post.content }</p>

            { el.Post.Tags.length && <div className="content-post__row content-post__row_tags">
              { el.Post.Tags.map(tag => (
                <Link key={el.Post.id + '-tag-' + tag.name } className="content-post__tag" to={ `/content/${this.getEvent(this.props, 'string')}?tag=` + tag.name }>{ tag.name }</Link>
              ))}
            </div>}

            <div className="content-post__row content-post__row_nfs">
              <StarRatingComponent name='post-nfs' starCount={10} editing={true} emptyStarColor='#e3e1d6' />
            </div>
          </div>    
        )) }      
        
      </div>

      <div className="PostsIndex__topics col-md-4 shrink show-for-large hidden-sm">
        <div className="Card Card__minus-margin">
          <ul className="Card__ul-citys">
            { tags.length && tags.map(el => (
              <li className={ this.getTag() === el.name ? "active" : "" } key={ 'content-tags-' + el.name }>
                <Link to={ `/content/${this.getEvent(this.props, 'string')}?tag=` + el.name }>{ el.name } ({ el.count })</Link>
              </li>
            )) }
          </ul>
        </div>
      </div>

    </div>)
  }
}

const UserIsAuthenticated = UserAuthWrapper({
  authSelector: state => state.user.get('current'),
  authenticatingSelector: state => state.user.get('logining'),
  wrapperDisplayName: 'UserIsAuthenticated',
  FailureComponent: () => <div>Вы не аутентифицированы. Войдите в аккаунт.</div>,
  LoadingComponent: () => <div>Загрузка...</div>
})

module.exports = {
  path: 'content(/:event)',
  component: UserIsAuthenticated(Content)
}

