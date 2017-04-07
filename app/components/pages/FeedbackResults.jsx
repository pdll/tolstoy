import React, { Component } from 'react'
import User from 'app/components/elements/User'
import StarRatingComponent from 'react-star-rating-component'
import Pagination from 'react-paginate'
import { Link } from 'react-router'
import { DropdownButton, MenuItem } from 'react-bootstrap'
import { LinkContainer } from 'react-router-bootstrap'

class FeedbackResults extends Component {
  constructor (props) {
    super(props)
    this.state = {
      perPage: 10,
      event: this.getEvent(),
      city: this.getCity(),
      day: this.getDay()
    }

    this.getNPS = this.getNPS.bind(this)
    this.getReplies = this.getReplies.bind(this)
    this.getEvent = this.getEvent.bind(this)
    this.getCities = this.getCities.bind(this)
    this.getDay = this.getDay.bind(this)
    this.getCity = this.getCity.bind(this)
  }

  componentDidMount () {
    this.getNPS()
    this.getReplies()
    this.getCities()
  }

  getEvent (props = this.props, type = 'numeric') {
    if (props.params.event === 'ceh') {
      return type === 'numeric' ? '1' : 'ceh'
    }
    if (props.params.event === 'mzs') {
      return type === 'numeric' ? '2' : 'mzs'
    }
    return type === 'numeric' ? '1' : 'ceh'
  }

  getCity () {
    return this.props.params.city || 'all'
  }

  getDay () {
    return this.props.params.day || 'all'
  }

  async getNPS (event = this.state.event, city = this.state.city, day = this.state.day) {
    const response = await fetch(`/api/v1/feedback/results/nps?event=${event}&city=${city}&day=${day}`)
    const nps = await response.json()
    this.setState({
      nps
    })
  }

  async getReplies (event = this.state.event, city = this.state.city, day = this.state.day, limit = this.state.perPage, offset = 0) {
    const response = await fetch(`/api/v1/feedback/results/replies?limit=${limit}&offset=${offset}&event=${event}&city=${city}&day=${day}`)
    const { replies, count } = await response.json()
    this.setState({
      replies,
      repliesCount: count
    })
  }

  async getCities (event = this.state.event) {
    const response = await fetch(`/api/v1/feedback/results/cities?event=${event}`)
    const { cities } = await response.json()
    this.setState({
      cities
    })
  }

  componentWillReceiveProps (nextProps) {
    const { city, day } = nextProps.params
    this.getCities(this.getEvent(nextProps))
    this.getNPS(this.getEvent(nextProps), city, day)
    this.getReplies(this.getEvent(nextProps), city, day)
  }

  render () {
    return (

      <div>




      <div className="PostsIndex__left col-md-8 col-sm-12 small-collapse">
        <ul className="HorizontalMenu menu FeedbackResults_menu">
          <li className={this.getEvent() === '1' ? 'active' : ''}>


            <Link to={`/feedback/results/ceh/all/all`}>ЦЕХ</Link>


          </li>

           <DropdownButton title='' bsStyle='link'>
             <LinkContainer to={`/feedback/results/ceh/all/all`}>
               <MenuItem>Весь ЦЕХ</MenuItem>
             </LinkContainer>
             <LinkContainer to={`/feedback/results/ceh/2017-03-18/all`}>
               <MenuItem>18 марта</MenuItem>
             </LinkContainer>
             <LinkContainer to={`/feedback/results/ceh/2017-03-25/all`}>
               <MenuItem>25 марта</MenuItem>
             </LinkContainer>
             <LinkContainer to={`/feedback/results/ceh/2017-04-01/all`}>
               <MenuItem>1 апреля</MenuItem>
             </LinkContainer>
             <LinkContainer to={`/feedback/results/ceh/2017-04-08/all`}>
               <MenuItem>8 апреля</MenuItem>
             </LinkContainer>
             <LinkContainer to={`/feedback/results/ceh/2017-04-15/all`}>
               <MenuItem>15 апреля</MenuItem>
             </LinkContainer>

    </DropdownButton>
          <li className={this.getEvent() === '2' ? 'active' : ''}>
            <Link to={`/feedback/results/mzs/all/all`}>МЗС</Link>
          </li>
            <DropdownButton title='' bsStyle='link'>
              <LinkContainer to={`/feedback/results/mzs/all/all`}>
                <MenuItem>Весь МЗС</MenuItem>
              </LinkContainer>
              <LinkContainer to={`/feedback/results/mzs/2017-03-14/all`}>
                <MenuItem>14 марта</MenuItem>
              </LinkContainer>
              <LinkContainer to={`/feedback/results/mzs/2017-03-21/all`}>
                <MenuItem>21 марта</MenuItem>
              </LinkContainer>
              <LinkContainer to={`/feedback/results/mzs/2017-03-28/all`}>
                <MenuItem>28 марта</MenuItem>
              </LinkContainer>
              <LinkContainer to={`/feedback/results/mzs/2017-04-04/all`}>
                <MenuItem>4 апреля</MenuItem>
              </LinkContainer>
              <LinkContainer to={`/feedback/results/mzs/2017-04-11/all`}>
                <MenuItem>11 апреля</MenuItem>
              </LinkContainer>
              <LinkContainer to={`/feedback/results/mzs/2017-04-18/all`}>
                <MenuItem>18 апреля</MenuItem>
              </LinkContainer>

    </DropdownButton>


     {this.state.cities && (
      <div className="FeedbackResults_cities-mobile">
     <DropdownButton title={this.getCity() === 'all' ? 'Все города' : this.getCity()} bsStyle='link'>

      <LinkContainer to={`/feedback/results/${this.getEvent(this.props, 'string')}/${this.getDay()}/all`}>
                <MenuItem>Все города</MenuItem>
              </LinkContainer>

          {this.state.cities.filter(x => x.name !== null).map(city => (
              <LinkContainer to={`/feedback/results/${this.getEvent(this.props, 'string')}/${this.getDay()}/${city.name}`}>
                <MenuItem>{city.name} ({city.count})</MenuItem>
              </LinkContainer>

              ))}

           <LinkContainer to={`/feedback/results/${this.getEvent(this.props, 'string')}/${this.getDay()}/other`}>
                <MenuItem>Другие города ({this.state.cities.filter(x => x.name === null)[0].count})</MenuItem>
              </LinkContainer>

          </DropdownButton>
        </div>

      )}

        </ul>
        {this.state.nps ? (
          <div className="PostSummary__NPS">
            <table className="PostSummary__NPS-table">
              <tbody>
                <tr>
                  <td>
                    <div className="PostSummary__NPS-title">{Math.round(this.state.nps.nps1 * 10) / 10}</div>
                    <div className="PostSummary__NPS-desc">Контент</div>
                  </td>
                  <td>
                    <div className="PostSummary__NPS-title">{Math.round(this.state.nps.nps2 * 10) / 10}</div>
                    <div className="PostSummary__NPS-desc">Эмоции</div>
                  </td>
                  <td>
                    <div className="PostSummary__NPS-title">{Math.round(this.state.nps.nps3 * 10) / 10}</div>
                    <div className="PostSummary__NPS-desc">Организация</div>
                  </td>
                  <td>
                    <div className="PostSummary__NPS-title">{Math.round(this.state.nps.nps * 10) / 10}</div>
                    <div className="PostSummary__NPS-desc">Общий</div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div>Загрузка...</div>
        )}
        {this.state.replies ? (
          <div>
            {this.state.replies.map(reply => (
              <div key={reply.id} className='PostSummary'>
                <div className='PostSummary__author_with_userpic'>
                  <User account={reply.User.name} />
                </div>
                <div className='PostSummary__content'>{reply.body}</div>
                <div style={{ marginTop: '30px' }}>
                  <div className="PostSummary__feedback-subtitle">Качество контента:</div>
                  <StarRatingComponent
                    name='content-quality'
                    starCount={10}
                    value={reply.score_1}
                    editing={false}
                    emptyStarColor='#e3e1d6' />
                  <div className="PostSummary__feedback-subtitle">Эмоции:</div>
                  <StarRatingComponent
                    name='emotions'
                    starCount={10}
                    value={reply.score_2}
                    editing={false}
                    emptyStarColor='#e3e1d6' />
                  <div className="PostSummary__feedback-subtitle">Организация:</div>
                  <StarRatingComponent
                    name='organization'
                    starCount={10}
                    value={reply.score_3}
                    editing={false}
                    emptyStarColor='#e3e1d6' />
                </div>
              </div>
            ))}
            <div className="Admin__pagination FeedbackResults_pagination">
              <Pagination
                  pageCount={Math.ceil((this.state.repliesCount || 0) / this.state.perPage)}
                  pageRangeDisplayed={3}
                  marginPagesDisplayed={3}
                  previousLabel='&laquo;'
                  nextLabel='&raquo;'
                  containerClassName='pagination'
                  activeClassName='active'
                  onPageChange={({ selected }) => {
                      const currentPage = selected + 1
                      const offset = this.state.perPage * selected
                      this.getReplies(this.getEvent(this.props), this.getCity(), this.getDay(), this.state.perPage, offset).then(() => window.scrollTo(0, 0))
                  }} />
            </div>
          </div>
        ) : (
          <div></div>
        )}
      </div>

      <div className="PostsIndex__topics col-md-4 shrink show-for-large hidden-sm">

        {this.state.cities && (
          <div className="Card Card__minus-margin">
            <ul className="Card__ul-citys">
              <li className={this.getCity() === 'all' ? "active": ""} >
                <Link to={`/feedback/results/${this.getEvent(this.props, 'string')}/${this.getDay()}/all`}>Все города</Link>
              </li>
              {this.state.cities.filter(x => x.name !== null).map(city => (
                <li className={this.getCity() === city.name ? "active": ""} key={city.name}>
                  <Link to={`/feedback/results/${this.getEvent(this.props, 'string')}/${this.getDay()}/${city.name}`}>{ city.name } ({ city.count })</Link>
                </li>
              ))}
              <li  className={this.getCity() === 'other' ? "active": ""} >
                <Link to={`/feedback/results/${this.getEvent(this.props, 'string')}/${this.getDay()}/other`}>Другие города ({this.state.cities.filter(x => x.name === null)[0].count})</Link>
            </li>
            </ul>
          </div>
        )}

                </div>

      </div>
    )
  }
}

module.exports = {
  path: 'feedback/results(/:event(/:day(/:city)))',
  component: FeedbackResults
}
