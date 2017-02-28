/* eslint react/prop-types: 0 */
import React from 'react';
import { Link } from 'react-router';
import {connect} from 'react-redux';
import transaction from 'app/redux/Transaction';
import user from 'app/redux/User';
import Icon from 'app/components/elements/Icon'
import UserKeys from 'app/components/elements/UserKeys';
import PasswordReset from 'app/components/elements/PasswordReset';
import UserWallet from 'app/components/modules/UserWallet';
import Settings from 'app/components/modules/Settings';
import CurationRewards from 'app/components/modules/CurationRewards';
import AuthorRewards from 'app/components/modules/AuthorRewards';
import UserList from 'app/components/elements/UserList';
import Follow from 'app/components/elements/Follow';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import PostsList from 'app/components/cards/PostsList';
import {isFetchingOrRecentlyUpdated} from 'app/utils/StateFunctions';
import {repLog10} from 'app/utils/ParsersAndFormatters.js';
import Tooltip from 'app/components/elements/Tooltip';
import { LinkWithDropdown } from 'react-foundation-components/lib/global/dropdown';
import VerticalMenu from 'app/components/elements/VerticalMenu';
import { translate } from 'app/Translator';
import ReplyEditorShort from 'app/components/elements/ReplyEditorShort'
import HorizontalMenu from 'app/components/elements/HorizontalMenu';
import resolveRoute from 'app/ResolveRoute';


import Products from 'app/components/elements/Products';
import Beta from 'app/components/elements/Beta';

// BMChain components/modules
import ViewUserBase from 'app/components/modules/user/views/ViewUserBase';
import ViewUserTarget from 'app/components/modules/user/views/ViewUserTarget';
import ViewUserMore from 'app/components/modules/user/views/ViewUserMore';
// elements
import Avatar from 'app/components/elements/Avatar';
import CardMyTen from 'app/components/elements/CardMyTen'

const formId = 'submitStory';
const SubmitReplyEditor = ReplyEditorShort(formId);

export default class TaskProfile extends React.Component {
    constructor() {
        super()
        this.state = {}
        this.onPrint = () => {window.print()}
        this.loadMore = this.loadMore.bind(this);
    }

    componentWillUnmount() {
        this.props.clearTransferDefaults()
    }

    loadMore(last_post, category) {
        const {accountname} = this.props.routeParams
        if (!last_post) return;

        let order;
        switch(category) {
          case "feed": order = 'by_feed'; break;
          case "blog": order = 'by_author'; break;
          default: console.log("unhandled category:", category);
        }

        if (isFetchingOrRecentlyUpdated(this.props.global.get('status'), order, category)) return;
        let [permlink, author] = last_post.split('/'); // destructuring assignment is a bullshit.
        if (!author) author = accountname; // crutch
        this.props.requestData({author, permlink, order, category, accountname});
    }

    render() {
        const {
            props: {current_user, wifShown},
            onPrint
        } = this;
        let { accountname, section } = this.props.routeParams;

        const username = current_user ? current_user.get('username') : null
        // const gprops = this.props.global.getIn( ['props'] ).toJS();
        if( !section ) section = 'blog';

        // const isMyAccount = current_user ? current_user.get('username') === accountname : false;
        let account
        let accountImm = this.props.global.getIn(['accounts', accountname]);
        if( accountImm ) {
            account = accountImm.toJS();
        }
        else {
            return <LoadingIndicator type="circle" inline />
        }

        let followerCount = 0, followingCount = 0;
        const followers = this.props.global.getIn( ['follow', 'get_followers', accountname] );
        const following = this.props.global.getIn( ['follow', 'get_following', accountname] );
        // let loadingFollowers = true, loadingFollowing = true;

        if (followers && followers.has('result')) {
            followerCount = followers.get('result').filter(a => {
                return a.get(0) === "blog";
            }).size;
            // loadingFollowers = followers.get("loading");
        }

        if (following && following.has('result')) {
            followingCount = following.get('result').filter(a => {
                return a.get(0) === "blog";
            }).size;
            // loadingFollowing = following.get("loading");
        }

        // Reputation
        const rep = repLog10(account.reputation);

        const isMyAccount = username === account.name
        const name = account


        let tab_content = null;

        const global_status = this.props.global.get('status');
        const status = global_status ? global_status.getIn([section, 'by_author']) : null;
        const fetching = (status && status.fetching) || this.props.loading;

        // let balance_steem = parseFloat(account.balance.split(' ')[0]);
        // let vesting_steem = vestingSteem(account, gprops).toFixed(2);
        // const steem_balance_str = numberWithCommas(balance_steem.toFixed(2)) + " STEEM";
        // const power_balance_str = numberWithCommas(vesting_steem) + " STEEM POWER";
        // const sbd_balance = parseFloat(account.sbd_balance)
        // const sbd_balance_str = numberWithCommas('$' + sbd_balance.toFixed(2));

        let rewardsClass = "";
        const jsonMetaData = JSON.parse(account.json_metadata)
        const {first_name, last_name} = jsonMetaData
        const fullName = first_name || last_name ? `${first_name} ${last_name}` : account.name

        if( section === 'transfers' ) {
            tab_content = <UserWallet global={this.props.global}
                          account={account}
                          showTransfer={this.props.showTransfer}
                          current_user={current_user}
                          withdrawVesting={this.props.withdrawVesting} />
        }
        else if( section === 'curation-rewards' ) {
            rewardsClass = "active";
            tab_content = <CurationRewards global={this.props.global}
                          account={account}
                          current_user={current_user}
                          />
        }
        else if( section === 'author-rewards' ) {
            rewardsClass = "active";
            tab_content = <AuthorRewards global={this.props.global}
                          account={account}
                          current_user={current_user} />
        }
        else if( section === 'followers' ) {
            if (followers && followers.has('result')) {
                tab_content = <UserList
                          title={translate('followers')}
                          account={account}
                          users={followers} />
            }
        }
        else if( section === 'followed' ) {
            if (following && following.has('result')) {
                tab_content = <UserList
                          title="Followed"
                          account={account}
                          users={following} />
            }
        }
        else if( section === 'settings' ) {
            tab_content = <Settings routeParams={this.props.routeParams} />
        }
        else if( section === 'posts' && account.post_history ) {
           if( account.posts )
           {
              tab_content = <section>
                  {isMyAccount ?
                      <div className="SubmitPost" style={{marginLeft: "10px"}}>
                          <SubmitReplyEditor
                              type="submit_story" />
                      </div>: null}
                  <PostsList
                      emptyText={translate('user_hasnt_made_any_posts_yet', {fullName})}
                      posts={account.posts.map(p => `${account.name}/${p}`)}
                      loading={fetching}
                      category="posts"
                      loadMore={null}
                      showSpam />
              </section>;
           }
           else {
              tab_content = (<center><LoadingIndicator type="circle" /></center>);
           }
        } else if(!section || section === 'blog') {
            if (account.blog) {
                tab_content = <section>
                
                    <PostsList
                        emptyText={translate('user_hasnt_started_bloggin_yet', {fullName})}
                        posts={account.blog}
                        loading={fetching}
                        category="blog"
                        loadMore={this.loadMore}
                        accountName={account.name}
                        showSpam />
                    </section>;
            } else {
                tab_content = (<center><LoadingIndicator type="circle" /></center>);
            }
        }
        // else if(!section || section === 'feed') {
        //     if (account.feed) {
        //         tab_content = <PostsList
        //             emptyText={`Looks like ${account.name} hasn't followed anything yet!`}
        //             posts={account.feed}
        //             loading={fetching}
        //             category="feed"
        //             loadMore={this.loadMore}
        //             showSpam />;
        //     } else {
        //         tab_content = (<center><LoadingIndicator type="circle" /></center>);
        //     }
        // }
        else if( (section === 'recent-replies') && account.recent_replies ) {
              tab_content =
                  <PostsList
                  emptyText={translate('user_hasnt_had_any_replies_yet', {fullName}) + '.'}
                  posts={account.recent_replies}
                  loading={fetching}
                  category="recent-replies"
                  loadMore={null}
                  showSpam={false} />;
        }
        else if( section === 'permissions' && isMyAccount ) {
            tab_content = <UserKeys account={accountImm} />
        } else if( section === 'password' ) {
            tab_content = <PasswordReset account={accountImm} />
        } else {
        //    console.log( "no matches" );
        }



        let printLink = null;
        let section_title = account.name + ' / ' + section;
        if( section === 'blog' ) {
           section_title = translate('users_blog', {name});
        } else if( section === 'transfers' ) {
           section_title = fullName + translate('users_wallet', {name});
        } else if( section === 'curation-rewards' ) {
          section_title = fullName + translate('users_curation_rewards', {name});
      } else if( section === 'author-rewards' ) {
        section_title = fullName + translate('users_author_rewards', {name});
        } else if( section === 'password' ) {
           section_title = ''
        } else if( section === 'permissions' ) {
           section_title = fullName + translate('users_permissions', {name})
           if(isMyAccount && wifShown) {

               printLink = <div><a className="float-right noPrint" onClick={onPrint}>
                   <Icon name="printer" />&nbsp;{translate('print')}&nbsp;&nbsp;
               </a></div>

           }
        } else if( section === 'posts' ) {
           section_title = fullName + translate('users_posts', {name});
        } else if( section === 'recent-replies' ) {
           section_title = translate('recent_replies_to_users_posts', {name});
        }

        const wallet_tab_active = section === 'transfers' || section === 'password' || section === 'permissions' ? 'active' : ''; // className={wallet_tab_active}

        let rewardsMenu = [
            {link: `/@${accountname}/curation-rewards`, label: translate('curation_rewards'), value: translate('curation_rewards')},
            {link: `/@${accountname}/author-rewards`, label: translate('author_rewards'), value: translate('author_rewards')}
        ];

        const top_menu = <div className="row UserProfile__top-menu">
            <div className="columns small-10 medium-12 medium-expand">
                <ul className="menu" style={{flexWrap: "wrap"}}>
                    <li><Link to={`/@${accountname}`} activeClassName="active">{translate('blog')}</Link></li>
                    <li><Link to={`/@${accountname}/posts`} activeClassName="active">{translate('comments')}</Link></li>
                    <li><Link to={`/@${accountname}/recent-replies`} activeClassName="active">{translate('replies')}</Link></li>
                    {/*<li><Link to={`/@${accountname}/feed`} activeClassName="active">{translate('feeds')}</Link></li>*/}
                    <li>
                        <LinkWithDropdown
                            closeOnClickOutside
                            dropdownPosition="bottom"
                            dropdownAlignment="right"
                            dropdownContent={
                                <VerticalMenu items={rewardsMenu} />
                            }
                        >
                            <a className={rewardsClass}>
                                {translate('rewards')}
                                <Icon name="dropdown-arrow" />
                            </a>
                        </LinkWithDropdown>
                    </li>

                </ul>
            </div>
            <div className="columns shrink">
                <ul className="menu" style={{flexWrap: "wrap"}}>
                    <li><Link to={`/@${accountname}/transfers`} activeClassName="active">{translate('wallet')}</Link></li>
                    {wallet_tab_active && isMyAccount && <li><Link to={`/@${account.name}/permissions`} activeClassName="active">{translate('permissions')}</Link></li>}
                    {wallet_tab_active && isMyAccount && <li><Link to={`/@${account.name}/password`} activeClassName="active">{translate('password')}</Link></li>}
                    <li><Link to={`/@${accountname}/settings`} activeClassName="active">{translate('settings')}</Link></li>
                </ul>
            </div>
         </div>;

        const background = jsonMetaData.background_image;
        let backgroundUrl
        if (background) backgroundUrl = {backgroundImage: "url('" + background + "')"};


        return (

           <div className={'PostsIndex row' + (fetching ? ' fetching' : '')}>
               


                <div className="PostsIndex__left col-md-8 col-sm-12 small-collapse">
                    
                        {/*section_title && <h2 className="UserProfile__section-title">{section_title}</h2>*/}

                       {/* <HorizontalMenu items={sort_order_menu_horizontal} /> */}
                        {tab_content}
                    
                </div>


                 <div className="PostsIndex__topics col-md-4 shrink show-for-large hidden-sm">

                    <Beta />
                   {/* <Products /> */}
                    <CardMyTen/>

                </div>

          
            </div>
        );
    }
}

module.exports = {
    path: '@:accountname(/:section)',
    component: connect(
        state => {
            const wifShown = state.global.get('UserKeys_wifShown')
            const current_user = state.user.get('current')
            // const current_account = current_user && state.global.getIn(['accounts', current_user.get('username')])
            return {
                discussions: state.global.get('discussion_idx'),
                global: state.global,
                current_user,
                // current_account,
                wifShown,
                loading: state.app.get('loading')
            };
        },
        dispatch => ({
            login: () => {dispatch(user.actions.showLogin())},
            clearTransferDefaults: () => {dispatch(user.actions.clearTransferDefaults())},
            showTransfer: (transferDefaults) => {
                dispatch(user.actions.setTransferDefaults(transferDefaults))
                dispatch(user.actions.showTransfer())
            },
            withdrawVesting: ({account, vesting_shares, errorCallback, successCallback}) => {
                const successCallbackWrapper = (...args) => {
                    dispatch({type: 'global/GET_STATE', payload: {url: `@${account}/transfers`}})
                    return successCallback(...args)
                }
                dispatch(transaction.actions.broadcastOperation({
                    type: 'withdraw_vesting',
                    operation: {account, vesting_shares},
                    errorCallback,
                    successCallback: successCallbackWrapper,
                }))
            },
            requestData: (args) => dispatch({type: 'REQUEST_DATA', payload: args}),
        })
    )(TaskProfile)
};
