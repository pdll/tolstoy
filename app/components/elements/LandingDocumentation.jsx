import React from 'react'

export default class LandingDocumentation extends React.Component {
	render() {
		return (
			<section className="Documentation">
				<div className="row text-center">
					<div className="   small-12 columns">
						<h2>Документация</h2>
						{/* 30px */}
						<span className="Landing__supporting-text">Децентрализованная социальная сеть для блоггеров и журналистов</span>
					</div>
				</div>
				<div className="row Documentation__image">
					<div className="small-12 columns">
						<img src="images/landing/docs.png" />
					</div>
				</div>
				<div className="row">
					<div className="small-12 columns">
						<p>Размещая свой персональный контент в социальных сетях Vkontakte, Facebook и Twitter, пользователи подняли ценность этих компаний до миллиардов долларов, чем обеспечили прибыль только акционерам.</p>
					</div>
					<div className="small-12 columns">
						<p className="Documentation_smaller-text">В противоположность этому, <span className="text-red">Голос возвращает большую часть своей стоимости</span> в виде вознаграждений в виртуальной валюте всем тем людям, которые своими действиями и вкладом обеспечили эту ценность.</p>
					</div>
				</div>
				<div className="row Documentation__buttons">
					<div className="small-12 columns">
						<a href="" className="button alert">Про Голос</a>
						<a href="" className="button">Про Стим</a>
					</div>
				</div>
			</section>
		)
	}
}