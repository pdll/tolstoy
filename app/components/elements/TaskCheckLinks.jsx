import React, {Component, PropTypes} from 'react';
import {connect} from 'react-redux';
import { Link } from 'react-router';

class TaskCheckLink extends Component {
	// you can pass either user object, or username string

  constructor(props) {
        super(props);
        this.state = {};
 
    }

    static defaultProps = {
		
	}





	render() {

    //let posts = this.getPosts('created', 'bm-tasks');


    let tasksToCheck
    if (this.props.current_program == '1') {tasksToCheck = <ol className="Card__ul-tasks">

        <li><Link to="/created/bm-taskceh1">Заполнить A/B</Link></li>
        <li><Link to="/created/bm-taskceh2">Задание на неделю 1</Link></li>
        <li><Link to="/created/bm-taskceh3">План-кинжал и упаковка</Link></li>
        <li><Link to="/created/bm-taskceh4">1000 посетителей и 100 репостов</Link></li>
        <li><Link to="/created/bm-taskceh5">100 целей, утро, декларация</Link></li>
         <li><Link to="/created/bm-taskceh6">Встречи, автоворонка</Link></li>
         <li><Link to="/created/bm-taskceh7">Отдых, автоворонка</Link></li>

    </ol>}

    if (this.props.current_program == '2') {tasksToCheck = <ol className="Card__ul-tasks">

       
        <li><Link to="/created/bm-taskmzs17">Отдых</Link></li>
    <li><Link to="/created/bm-taskmzs18">Автоматизация, отчет</Link></li>
        
        

    </ol>}

		
		return 	<section className="Card Card__minus-margin">

        <div className="Card__schedule-title">
            Задания на проверку
        </div>

       
            {tasksToCheck}

        


        </section>
	}
}


export default connect(
    state => {
   

        const current_program = state.user.get('currentProgram');


       
        return {
    
            current_program
        }
    }
)(TaskCheckLink);

