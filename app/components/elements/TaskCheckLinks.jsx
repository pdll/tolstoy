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

    </ol>}

    if (this.props.current_program == '2') {tasksToCheck = <ol className="Card__ul-tasks">

        <li><Link to="/created/bm-taskmzs7">Упаковать первый экран</Link></li>
        <li><Link to="/created/bm-taskmzs8">Сделать 2000 переходов</Link></li>
        <li><Link to="/created/bm-taskmzs9">Проработать смыслы</Link></li>
        <li><Link to="/created/bm-taskmzs10">Создать лид-магнит</Link></li>
        <li><Link to="/created/bm-taskmzs11">УЕженедельный отчет в деньгах</Link></li>
        

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

