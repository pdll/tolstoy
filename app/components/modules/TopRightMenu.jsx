import Immutable from 'immutable';
import React from 'react';
import { Link } from 'react-router';
import {connect} from 'react-redux';
import Icon from 'app/components/elements/Icon';
import user from 'app/redux/User';
import Userpic from 'app/components/elements/Userpic';
import { browserHistory } from 'react-router';
import { LinkWithDropdown } from 'react-foundation-components/lib/global/dropdown';
import VerticalMenu from 'app/components/elements/VerticalMenu';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import { translate } from 'app/Translator';
import {numberWithCommas, vestingSteem} from 'app/utils/StateFunctions';


const defaultNavigate = (e) => {
    // do not navigate if middle mouse button is clicked
    if (e && (e.which == 2 || e.button == 4)) return

    e.preventDefault();
    const a = e.target.nodeName.toLowerCase() === 'a' ? e.target : e.target.parentNode;
    browserHistory.push(a.pathname + a.search + a.hash);
};

function TopRightMenu({username, showLogin, logout, loggedIn, showSignUp, userpic, vertical, navigate, toggleOffCanvasMenu, probablyLoggedIn, location, gprops, account, logining, currentProgram, allPrograms, updateProgram}) {
    const mcn = 'menu' + (vertical ? ' vertical show-for-small-only' : '');
    const mcl = vertical ? '' : ' sub-menu';
    const lcn = vertical ? '' : 'show-for-medium';
    const nav = navigate || defaultNavigate;
    const submit_story = $STM_Config.read_only_mode ? null : <li className={lcn + ' submit-story'}><a href="/submit.html" onClick={nav}>{translate("submit_a_story")}</a></li>;
    const userpic_src = userpic || '/images/user.png';
    const feed_link = `/@${username}/feed`;
    const replies_link = `/@${username}/recent-replies`;
    const wallet_link = `/@${username}/transfers`;
    const settings_link = `/@${username}/settings`;
    const account_link = `/@${username}`;
    const posts_link = `/@${username}/posts`;
    const reset_password_link = `/@${username}/password`;
    const feedback_link = `/feedback`;

    let vesting_steem
    if (account) {
        vesting_steem = vestingSteem(account.toJS(), gprops).toFixed(2)
    }


    function trackAnalytics(eventType) {
        console.log(eventType)
        analytics.track(eventType)
    }
    if (loggedIn) { // change back to if(username) after bug fix:  Clicking on Login does not cause drop-down to close #TEMP!
        const user_menu = [

            {link: account_link, value: translate('profile')},

            {link: replies_link, value: translate('replies')},
            {link: feedback_link, value: 'Оставить отзыв'},
           //{link: wallet_link, value: translate('wallet')},
            //{link: reset_password_link, value: translate('change_password')},
            {link: settings_link, value: translate('settings')},
            loggedIn ?
                {link: '#', onClick: logout, value: translate('logout')} :
                {link: '#', onClick: showLogin, value: translate('login')}
        ];
        const search = translate('search')
        if (location && location.pathname.indexOf("/ico") != -1) {
            return (
                <ul className={mcn + ' landing'}>
                    {/* <li className={lcn + ' buttons'}>
                        <a href="/ru--diskleijmer/@hipster/diskleimer-o-vyplatakh-i-o-cuti-platformy" className="button alert">Дисклеймер</a>
                    </li> */}

                    <LinkWithDropdown
                        closeOnClickOutside
                        dropdownPosition="bottom"
                        dropdownAlignment="right"
                        dropdownContent={<VerticalMenu items={user_menu} title={username} />}
                        onClick={trackAnalytics.bind(this, 'user dropdown menu clicked')}
                    >
                        {!vertical && <li className={'Header__userpic '}>
                            <a href={account_link} title={username} onClick={e => e.preventDefault()}>
                                <Userpic account={username} width="36" height="36" />
                            </a>
                        </li>}
                    </LinkWithDropdown>

                </ul>
            );
            return      <ul className={mcn + mcl + ' landing'}>
                            {/* <li className={lcn + ' buttons'}>
                                <a href="/ru--diskleijmer/@hipster/diskleimer-o-vyplatakh-i-o-cuti-platformy" className="button alert">Дисклеймер</a>
                            </li> */}

                            <li className={lcn + ' image-wrapper'}>
                                <a href="/login.html">
                                    <img src="images/user.png" width="36" height="36" />
                                    <span>Вход</span>
                                </a>
                            </li>
                            <li className={lcn}><LoadingIndicator type="circle" inline /></li>

                        </ul>
        }

/*
                <li><a href={`/@${username}/transfers#buy_golos`} className="button alert">купить голоса</a></li>
                   move down on ICO start....
*/
        return (
            <ul className={mcn}>
                 <li className={lcn}><Link to={wallet_link} className="TopRightMenu_sila-link"><div className="TopRightMenu_sila">{vesting_steem && Math.round(vesting_steem)}</div></Link></li>

                <li className={lcn}><a href="/static/search.html" title={search}>{vertical ? <span>{search}</span> : <div className="TopRightMenu__search-icon"></div>}</a></li>
                {allPrograms && (
                  <li>
                    <select
                      defaultValue={currentProgram}
                      className="TopRightMenu__switchBtn"
                      
                      onChange={updateProgram}>
                      <option value='1'>ЦЕХ</option>
                      <option value='2'>МЗС</option>
                    </select>
                  </li>
                )}
                <LinkWithDropdown
                    closeOnClickOutside
                    dropdownPosition="bottom"
                    dropdownAlignment="right"
                    dropdownContent={<VerticalMenu items={user_menu} />}
                    onClick={trackAnalytics.bind(this, 'user dropdown menu clicked')}
                >
                    {!vertical && <li className={'Header__userpic '}>
                        <a href={account_link} title={username} onClick={e => e.preventDefault()}>
                            <Userpic account={username} width="40" height="40" />
                        </a>
                    </li>}
                </LinkWithDropdown>

            </ul>
        );
    }
    if (probablyLoggedIn || logining) {
        if (location && location.pathname.indexOf("/ico") != -1) {
            return      <ul className={mcn + mcl + ' landing'}>
                            {/* <li className={lcn + ' buttons'}>
                                <a href="/ru--diskleijmer/@hipster/diskleimer-o-vyplatakh-i-o-cuti-platformy" className="button alert">Дисклеймер</a>
                            </li> */}


                            <li className={lcn + ' image-wrapper'}>
                                <a href="/signup.html">
                                    <img src="images/user.png" width="36" height="36" />
                                    <span>Регистрация</span>
                                </a>
                            </li>
                            <li className={lcn + ' image-wrapper'}>
                                <a href="/login.html">
                                    <img src="images/user.png" width="36" height="36" />
                                    <span>Вход</span>
                                </a>
                            </li>
                            <li className={lcn}><LoadingIndicator type="circle" inline /></li>

                        </ul>
        }

        return (
            <ul className={mcn + mcl}>


                {!vertical && <li><a href="/static/search.html" title="Поиск"><div className="TopRightMenu__search-icon"></div></a></li>}
                <li className={lcn}><LoadingIndicator type="circle" inline /></li>

            </ul>
        );
    }

    if (location && location.pathname.indexOf("/ico") != -1) {
        return  <ul className={mcn + mcl + ' landing'}>
                    {/* <li className={lcn + ' buttons'}>
                        <a href="/ru--diskleijmer/@hipster/diskleimer-o-vyplatakh-i-o-cuti-platformy" className="button alert">Дисклеймер</a>
                    </li> */}

                    <li className={lcn}>
                        <a href="#what-is-golos">Видео</a>
                    </li>
                    <li className={lcn}>
                        <a href="#docs">Документация</a>
                    </li>
                    <li className={lcn}>
                        <a href="#faq">FAQ</a>
                    </li>
                    <li className={lcn}>
                        <a href="#team">Команда</a>
                    </li>
                    <li className={lcn + ' image-wrapper'}>
                        <a href="/login.html">
                            <img src="images/user.png" width="36" height="36" />
                            <span>Вход</span>
                        </a>
                    </li>

                </ul>
    }
    return (
            <ul className={mcn + mcl}>
                {/*<li className={lcn + ' buttons'}>
                     <a href="/ru--diskleijmer/@hipster/diskleimer-o-vyplatakh-i-o-cuti-platformy" className="button alert">Дисклеймер</a>
                </li>*/}

                {!vertical && <li><a href="/static/search.html" title="Поиск"><div className="TopRightMenu__search-icon"></div></a></li>}
               <li className='TopRightMenu__signupbtn'><a className="TopRightMenu__signupbtn-link" href="/create_account" onClick={showSignUp}>{translate('sign_up')}</a></li>
                <li className='TopRightMenu__loginbtn'><a href="/login.html" onClick={showLogin}>{translate('login')}</a></li>


            </ul>
        );
}

TopRightMenu.propTypes = {
    username: React.PropTypes.string,
    loggedIn: React.PropTypes.bool,
    probablyLoggedIn: React.PropTypes.bool,
    userpic: React.PropTypes.string,
    showLogin: React.PropTypes.func.isRequired,
    showSignUp: React.PropTypes.func.isRequired,
    logout: React.PropTypes.func.isRequired,
    vertical: React.PropTypes.bool,
    navigate: React.PropTypes.func,
    toggleOffCanvasMenu: React.PropTypes.func

};

export default connect(
    state => {
        if (!process.env.BROWSER) {
            return {
                username: null,
                userpic: null,
                loggedIn: false,
                probablyLoggedIn: !!state.offchain.get('account')
            }
        }
        const username = state.user.getIn(['current', 'username']);
        const current_user = state.user.get('current');
        const loggedIn = !!username;
        const gprops = state.global.getIn(['props']).toJS();
        const account = state.global.getIn(['accounts', username]);
        return {
            username,
            userpic: null, // state.offchain.getIn(['user', 'picture']),
            loggedIn,
            probablyLoggedIn: false,
            gprops,
            account,
            logining: state.user.get('logining'),
            allPrograms: state.user.get('allPrograms'),
            currentProgram: state.user.get('currentProgram')
        }
    },
    dispatch => ({
        showLogin: e => {
            if (e) e.preventDefault();
            dispatch(user.actions.showLogin())
        },
        logout: e => {
            if (e) e.preventDefault();
            dispatch(user.actions.logout())
        },
        showSignUp: e => {
            if (e) e.preventDefault();
            dispatch(user.actions.showSignUp())
        },
        updateProgram: e => {
          if (e) e.preventDefault();
          dispatch(user.actions.updateProgram(e.target.value))
        }
    })
)(TopRightMenu);
