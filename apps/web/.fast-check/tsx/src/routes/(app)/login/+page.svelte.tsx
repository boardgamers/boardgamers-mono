///<reference types="svelte" />
;
import { Button, FormGroup, Label } from "@/modules/cdk";
import { handleError } from "@/utils";
import { useLoggedOut } from "@/lib/auth-guards.svelte";
import { redirectLoggedOut } from "@/utils/redirect";
import { SEO } from "@/components";
import { login } from "@/lib/account.svelte";
function $$render() {

  
  
  
  
  
  

  useLoggedOut();

  let email = "";
  let password = "";

  function handleLogin() {
    login(email, password).catch(handleError);
  }
;
async () => {

 { const $$_OES0C = __sveltets_2_ensureComponent(SEO); new $$_OES0C({ target: __sveltets_2_any(), props: {  "title":`Login`,}});}

 { svelteHTML.createElement("form", {  "on:submit":handleLogin,});
   { const $$_puorGmroF1C = __sveltets_2_ensureComponent(FormGroup); new $$_puorGmroF1C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
     { const $$_lebaL2C = __sveltets_2_ensureComponent(Label); new $$_lebaL2C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"for":`email`,}});  Label}
     { svelteHTML.createElement("input", {              "bind:value":email,"type":`email`,"class":`form-control`,"id":`email`,"name":`email`,"placeholder":`Email address`,"required":true,});/*Ωignore_startΩ*/() => email = __sveltets_2_any(null);/*Ωignore_endΩ*/}
   FormGroup}
   { const $$_puorGmroF1C = __sveltets_2_ensureComponent(FormGroup); new $$_puorGmroF1C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
     { const $$_lebaL2C = __sveltets_2_ensureComponent(Label); new $$_lebaL2C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"for":`password`,}});  Label}
     { svelteHTML.createElement("input", {              "type":`password`,"class":`form-control`,"id":`password`,"name":`password`,"placeholder":`Password`,"bind:value":password,"required":true,});/*Ωignore_startΩ*/() => password = __sveltets_2_any(null);/*Ωignore_endΩ*/}
     { svelteHTML.createElement("div", { "class":`text-end mt-1`,});
       { svelteHTML.createElement("a", { "href":`/forgotten-password`,}); { svelteHTML.createElement("small", {});   } }
     }
   FormGroup}
   { const $$_nottuB1C = __sveltets_2_ensureComponent(Button); new $$_nottuB1C({ target: __sveltets_2_any(), props: {     children:() => { return __sveltets_2_any(0); },"type":`submit`,"color":`primary`,"class":`pull-right`,}});  Button}
 }

 { svelteHTML.createElement("hr", {});}

 { svelteHTML.createElement("p", {});     { svelteHTML.createElement("a", { "href":`/signup`,});  } }
};
return { props: {} as Record<string, never>, exports: {}, bindings: "", slots: {}, events: {} }}
const Page__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type Page__SvelteComponent_ = InstanceType<typeof Page__SvelteComponent_>;
/*Ωignore_endΩ*/export default Page__SvelteComponent_;