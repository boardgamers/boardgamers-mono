///<reference types="svelte" />
;
import type { IUser } from "@bgs/models";
import { UserGames, UserElo, SEO, UserAvatar } from "@/components";
import { Row, Col, Container, Card } from "@/modules/cdk";
import { account } from "@/lib/account.svelte";
import { dateFromObjectId } from "@/utils";
import { page } from "$app/stores";

;type $$ComponentProps =  { data: { user: IUser } };function $$render() {
/*Ωignore_startΩ*/;let $account = __sveltets_2_store_get(account);;let $page = __sveltets_2_store_get(page);/*Ωignore_endΩ*/
  
  
  
  
  
  

  let { data }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  let username = $derived(data.user.account.username);
  let joinDate = $derived(data.user && dateFromObjectId(data.user._id));
;
async () => {

 { const $$_OES0C = __sveltets_2_ensureComponent(SEO); new $$_OES0C({ target: __sveltets_2_any(), props: {       "title":`${username}'s profile`,"description":data.user.account.bio ||
    `${username} joined in ${dateFromObjectId(data.user._id).toLocaleString("en", {
      month: "long",
    })} ${dateFromObjectId(data.user._id).toLocaleString("en", { year: "numeric" })} and has ${data.user.account.karma} karma.`,"image":`${$page.url.origin}/api/user/${data.user._id}/avatar`,}});}

 { const $$_reniatnoC0C = __sveltets_2_ensureComponent(Container); new $$_reniatnoC0C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
   { svelteHTML.createElement("div", { "class":`user-layout`,});
     { svelteHTML.createElement("div", { "class":`user-info`,});
       { const $$_ratavAresU3C = __sveltets_2_ensureComponent(UserAvatar); new $$_ratavAresU3C({ target: __sveltets_2_any(), props: {         "username":data.user.account.username,...__sveltets_2_cssProp({"--avatar-border":`1px solid gray`}),"userId":data.user._id,"size":`8rem`,}});}
       { svelteHTML.createElement("h1", {});username; }
       { svelteHTML.createElement("div", {});
          { svelteHTML.createElement("a", {   "href":`/page/karma`,"title":`karma`,});data.user.account.karma; }   { svelteHTML.createElement("br", {});}
            joinDate.toLocaleString("en", { month: "long" });
        joinDate.toLocaleString("default", { year: "numeric" });
       }
      if(data.user.account.bio){ { svelteHTML.createElement("p", {   "class":`mt-2`,"title":`${data.user.account.username}'s bio`,});
           data.user.account.bio;
         }}
      if(data.user && $account?._id === data.user._id){
         { svelteHTML.createElement("a", {     "class":`btn btn-primary`,"href":`/account`,"role":`button`,});  }
      }
     }
     { svelteHTML.createElement("div", { "style":`flex-grow: 3`,});
       { const $$_semaGresU3C = __sveltets_2_ensureComponent(UserGames); new $$_semaGresU3C({ target: __sveltets_2_any(), props: {  "userId":data.user._id,}});}

       { const $$_draC3C = __sveltets_2_ensureComponent(Card); new $$_draC3C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"class":`border-secondary mt-4`,"header":`Statistics`,}});
         { const $$_woR4C = __sveltets_2_ensureComponent(Row); new $$_woR4C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
           { const $$_loC5C = __sveltets_2_ensureComponent(Col); new $$_loC5C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"lg":6,"class":`mb-3`,}});
             { const $$_olEresU6C = __sveltets_2_ensureComponent(UserElo); new $$_olEresU6C({ target: __sveltets_2_any(), props: {  "userId":data.user._id,}});}
           Col}
           { const $$_loC5C = __sveltets_2_ensureComponent(Col); new $$_loC5C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
             { svelteHTML.createElement("h3", { "class":`card-title`,});  }
             { svelteHTML.createElement("p", {});    }
           Col}
         Row}
       Card}
     }
   }
 Container}


};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Page__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Page__SvelteComponent_ = ReturnType<typeof Page__SvelteComponent_>;
/*Ωignore_endΩ*/export default Page__SvelteComponent_;