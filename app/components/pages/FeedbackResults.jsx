import React, { Component } from 'react'
import User from 'app/components/elements/User'
import StarRatingComponent from 'react-star-rating-component'

class FeedbackResults extends Component {
  constructor (props) {
    super(props)
    this.state = {}

    this.getData = this.getData.bind(this)
  }

  componentDidMount () {
    this.getData()
  }

  async getData () {
    const response = await fetch('/api/v1/feedback/results')
    const data = await response.json()
    this.setState({
      data
    })
  }

  render () {
    return (<div>
      {this.state.data ? (<div>
        <div className="PostSummary__NPS">
          <table className="PostSummary__NPS-table">
            <tbody>
              <tr>
                <td>
                  <div className="PostSummary__NPS-title">{Math.round(this.state.data.nps1 * 10) / 10}</div>
                  <div className="PostSummary__NPS-desc">Контент</div>
                </td>
                <td>
                  <div className="PostSummary__NPS-title">{Math.round(this.state.data.nps2 * 10) / 10}</div>
                  <div className="PostSummary__NPS-desc">Эмоции</div>
                </td>
                <td>
                  <div className="PostSummary__NPS-title">{Math.round(this.state.data.nps3 * 10) / 10}</div>
                  <div className="PostSummary__NPS-desc">Организация</div>
                </td>
                <td>
                  <div className="PostSummary__NPS-title">{Math.round(this.state.data.nps * 10) / 10}</div>
                  <div className="PostSummary__NPS-desc">Общий</div>
                </td>
              </tr>
            </tbody>
          </table>
           </div>
          <div>
            {this.state.data.replies.map(reply => (
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
                    value={reply.total_score_1}
                    editing={false}
                    emptyStarColor='#e3e1d6' />
                  <div className="PostSummary__feedback-subtitle">Эмоции:</div>
                  <StarRatingComponent
                    name='emotions'
                    starCount={10}
                    value={reply.total_score_2}
                    editing={false}
                    emptyStarColor='#e3e1d6' />
                  <div className="PostSummary__feedback-subtitle">Организация:</div>
                  <StarRatingComponent
                    name='organization'
                    starCount={10}
                    value={reply.total_score_3}
                    editing={false}
                    emptyStarColor='#e3e1d6' />
                </div>
              </div>
            ))}
          </div>
          </div>
       
      ) : (
        <div>Загрузка</div>
      )}
    </div>)
  }
}

module.exports = {
  path: 'feedback/results',
  component: FeedbackResults
}
