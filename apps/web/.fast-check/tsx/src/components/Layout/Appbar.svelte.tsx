///<reference types="svelte" />
;
import {
    Navbar,
    Nav,
    Dropdown,
    DropdownToggle,
    DropdownMenu,
    Button,
    Input,
    Form,
    FormGroup,
    Label,
    FormText,
    NavLink,
    Icon,
  } from "@/modules/cdk";
import gearFill from "@iconify/icons-bi/gear-fill.js";
import power from "@iconify/icons-bi/power.js";
import { handleError } from "@/utils";
import { account as user, login, logout } from "@/lib/account.svelte";
import { logoClick } from "@/lib/stores.svelte";
import { activeGames } from "@/lib/stores.svelte";
import { browser } from "$app/environment";
import UserAvatar from "../User/UserAvatar.svelte";
function $$render() {
/*Ωignore_startΩ*/;let $user = __sveltets_2_store_get(user);;let $activeGames = __sveltets_2_store_get(activeGames);/*Ωignore_endΩ*/
  
  
  
  
  
  
  
  
  

  let email = "";
  let password = "";
  let className = "";
  let admin: boolean;
  let hasGames: boolean;

  

  const handleSubmit = (event: Event) => {
    event.preventDefault();

    login(email, password).catch(handleError);
  };

  const logOut = () => {
    logout().catch(handleError);
  };

  $: admin = __sveltets_2_invalidate(() => $user?.authority === "admin");
  // todo use load() function of svelte kit instead
  // $: adminLink =
  //   location.hostname === "localhost"
  //     ? "http://localhost:8613"
  //     : `${location.protocol}//admin.${location.hostname.slice(location.hostname.indexOf(".") + 1)}`;
  const adminLink = "https://admin.boardgamers.space";
  $: hasGames = __sveltets_2_invalidate(() => $activeGames.length > 0);

  const onHasGamesChanged = () => {
    if (hasGames) {
      if (document.hidden) {
        if ($user?.settings?.game?.soundNotification) {
          (document.getElementById("sound-notification") as HTMLAudioElement).play();
        }
        if (localStorage.getItem("notifications")) {
          new Notification("Boardgamers 🌌", { icon: "/favicon-active.ico", body: "It's your turn!" });
        }
      }
    }
  };

  ;() => {$: (browser && onHasGamesChanged(), [hasGames]);}
;
async () => {

 { const $$_rabvaN0C = __sveltets_2_ensureComponent(Navbar); new $$_rabvaN0C({ target: __sveltets_2_any(), props: {    children:() => { return __sveltets_2_any(0); },"color":`primary`,"class":className,"dark":true,"expand":true,}});
   { svelteHTML.createElement("a", {       "href":`/`,"on:click":logoClick,"data-sveltekit-preload-data":`hover`,"class":`navbar-brand`,});  }

  if($user){
     { svelteHTML.createElement("a", {           "class":`btn btn-sm me-3`,"href":`/next-game`,"title":`Jump to next active game`,"id":`active-game-count`,});hasGames;!hasGames;
      $activeGames.length;
     }
  }

   { svelteHTML.createElement("a", {     "href":`/boardgames`,"title":`Boardgames list`,"data-sveltekit-preload-data":`hover`,});
     { svelteHTML.createElement("img", {        "src":`/images/icons/dice.svg`,"height":`28`,"width":`28`,"alt":`Boardgames list`,});}
   }

   { svelteHTML.createElement("audio", {   "preload":`none`,"id":`sound-notification`,});
     { svelteHTML.createElement("source", {    "src":`/audio/notification.mp3`,"type":`audio/mpeg`,});}
     { svelteHTML.createElement("source", {    "src":`/audio/notification.ogg`,"type":`audio/ogg`,});}
   }

   { const $$_vaN1C = __sveltets_2_ensureComponent(Nav); new $$_vaN1C({ target: __sveltets_2_any(), props: {  children:() => { return __sveltets_2_any(0); },"class":`ms-auto`,"navbar":true,}});
    if(!$user){
      
       { svelteHTML.createElement("span", { "class":`navbar-text`,});   }
       { const $$_nwodporD2C = __sveltets_2_ensureComponent(Dropdown); new $$_nwodporD2C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },"nav":true,"inNavbar":true,}});
         { const $$_elggoTnwodporD3C = __sveltets_2_ensureComponent(DropdownToggle); new $$_elggoTnwodporD3C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },"nav":true,"caret":true,}});  DropdownToggle}
         { const $$_uneMnwodporD3C = __sveltets_2_ensureComponent(DropdownMenu); new $$_uneMnwodporD3C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"right":true,"class":`login-dp`,}});
           { svelteHTML.createElement("div", { "class":`row`,});
             { svelteHTML.createElement("div", { "class":`col-md-12`,});
                
               { svelteHTML.createElement("div", { "class":`social-buttons`,});
                 { const $$_nottuB7C = __sveltets_2_ensureComponent(Button); new $$_nottuB7C({ target: __sveltets_2_any(), props: {     children:() => { return __sveltets_2_any(0); },"href":`/api/account/auth/google`,"rel":`external`,"class":`google`,}});  Button}
                 { const $$_nottuB7C = __sveltets_2_ensureComponent(Button); new $$_nottuB7C({ target: __sveltets_2_any(), props: {     children:() => { return __sveltets_2_any(0); },"href":`/api/account/auth/discord`,"rel":`external`,"class":`discord`,}});  Button}
                 { const $$_nottuB7C = __sveltets_2_ensureComponent(Button); new $$_nottuB7C({ target: __sveltets_2_any(), props: {     children:() => { return __sveltets_2_any(0); },"href":`/api/account/auth/facebook`,"rel":`external`,"class":`facebook`,}});  Button}
               }
              
               { const $$_mroF6C = __sveltets_2_ensureComponent(Form); const $$_mroF6 = new $$_mroF6C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"class":`mt-3`,}});$$_mroF6.$on("submit", handleSubmit);
                 { const $$_puorGmroF7C = __sveltets_2_ensureComponent(FormGroup); new $$_puorGmroF7C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
                   { const $$_lebaL8C = __sveltets_2_ensureComponent(Label); new $$_lebaL8C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"hidden":true,"for":`email`,}});  Label}
                    { const $$_tupnI8C = __sveltets_2_ensureComponent(Input); const $$_tupnI8 = new $$_tupnI8C({ target: __sveltets_2_any(), props: {       "id":`email`,"type":`email`,"required":true,value:email,"autofocus":true,}});/*Ωignore_startΩ*/() => email = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_tupnI8.$$bindings = 'value';}
                 FormGroup}
                 { const $$_puorGmroF7C = __sveltets_2_ensureComponent(FormGroup); new $$_puorGmroF7C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
                   { const $$_lebaL8C = __sveltets_2_ensureComponent(Label); new $$_lebaL8C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"hidden":true,"for":`password`,}});  Label}
                    { const $$_tupnI8C = __sveltets_2_ensureComponent(Input); const $$_tupnI8 = new $$_tupnI8C({ target: __sveltets_2_any(), props: {      "id":`password`,"type":`password`,value:password,"required":true,}});/*Ωignore_startΩ*/() => password = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_tupnI8.$$bindings = 'value';}
                   { const $$_txeTmroF8C = __sveltets_2_ensureComponent(FormText); new $$_txeTmroF8C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"class":`mt-2 pt-2`,}});
                     { svelteHTML.createElement("a", { "href":`/forgotten-password`,});   }
                   FormText}
                 FormGroup}
                 { const $$_puorGmroF7C = __sveltets_2_ensureComponent(FormGroup); new $$_puorGmroF7C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
                   { const $$_nottuB8C = __sveltets_2_ensureComponent(Button); new $$_nottuB8C({ target: __sveltets_2_any(), props: {    children:() => { return __sveltets_2_any(0); },"type":`submit`,"color":`primary`,"block":true,}});  Button}
                 FormGroup}
               Form}
             }
             { svelteHTML.createElement("div", { "class":`bottom text-center bg-red-300`,});
                 { svelteHTML.createElement("a", { "href":`/signup`,}); { svelteHTML.createElement("b", {});  } }
             }
           }
         DropdownMenu}
       Dropdown}
    }else{
      if(admin){
         { const $$_kniLvaN2C = __sveltets_2_ensureComponent(NavLink); new $$_kniLvaN2C({ target: __sveltets_2_any(), props: {     children:() => { return __sveltets_2_any(0); },"href":adminLink,"class":`d-flex`,"style":`align-items: center; gap: 0.5em`,}});
           { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {      "icon":gearFill,"inline":true,"class":`big`,}});}
           { svelteHTML.createElement("span", { "class":`d-none d-sm-inline`,});  }
         NavLink}
      }
       { const $$_kniLvaN2C = __sveltets_2_ensureComponent(NavLink); new $$_kniLvaN2C({ target: __sveltets_2_any(), props: {     children:() => { return __sveltets_2_any(0); },"href":`/user/${$user.account.username}`,"data-sveltekit-preload-data":`hover`,"class":`appbar-user-link`,}});
         { const $$_ratavAresU3C = __sveltets_2_ensureComponent(UserAvatar); new $$_ratavAresU3C({ target: __sveltets_2_any(), props: {      "username":$user.account.username,"userId":$user._id,"size":`2rem`,}});}
         { svelteHTML.createElement("span", { "class":`d-none d-sm-inline`,});$user.account.username; }
       NavLink}
       { const $$_kniLvaN2C = __sveltets_2_ensureComponent(NavLink); const $$_kniLvaN2 = new $$_kniLvaN2C({ target: __sveltets_2_any(), props: {      children:() => { return __sveltets_2_any(0); },"class":`d-flex`,"style":`align-items: center; gap: 0.5em`,}});$$_kniLvaN2.$on("click", logOut);
         { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {      "icon":power,"inline":true,"class":`big`,}});}
         { svelteHTML.createElement("span", { "class":`d-none d-sm-inline`,});  }
       NavLink}
    }
   Nav}
 Navbar}


};
return { props: {class: className} as {class?: typeof className}, exports: {}, bindings: "", slots: {}, events: {} }}
const Appbar__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type Appbar__SvelteComponent_ = InstanceType<typeof Appbar__SvelteComponent_>;
/*Ωignore_endΩ*/export default Appbar__SvelteComponent_;