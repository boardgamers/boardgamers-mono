///<reference types="svelte" />
;
import { SEO } from "@/components";
import { useLoggedOut } from "@/lib/auth-guards.svelte";
import { post } from "@/lib/api";
import { handleError, handleInfo } from "@/utils";
function $$render() {

  
  
  
  

  useLoggedOut();
  let email = "";
  function handleSubmit() {
    post("/account/forget", { email }).then(() => handleInfo("An email was sent to reset your password"), handleError);
  }
;
async () => {

 { const $$_OES0C = __sveltets_2_ensureComponent(SEO); new $$_OES0C({ target: __sveltets_2_any(), props: {  "title":`Forgotten password`,}});}
 { svelteHTML.createElement("div", { "class":`goldfish container`,});
   { svelteHTML.createElement("h1", {});  }
   { svelteHTML.createElement("form", {       "method":`post`,"accept-charset":`UTF-8`,"role":`form`,"on:submit":handleSubmit,});
     { svelteHTML.createElement("div", { "class":`form-group`,});
       { svelteHTML.createElement("label", { "for":`email`,});  }
        { svelteHTML.createElement("input", {          "type":`email`,"class":`form-control`,"id":`email`,"placeholder":`Email address`,"bind:value":email,"required":true,});/*Ωignore_startΩ*/() => email = __sveltets_2_any(null);/*Ωignore_endΩ*/}
     }
     { svelteHTML.createElement("button", {   "type":`submit`,"class":`btn btn-primary pull-right mt-3`,});  }
   }
   { svelteHTML.createElement("hr", {});}
   { svelteHTML.createElement("p", {});    { svelteHTML.createElement("a", { "href":`/signup`,});  } }
   { svelteHTML.createElement("p", {});    { svelteHTML.createElement("a", { "href":`/`,});  }  }
 }
};
return { props: {} as Record<string, never>, exports: {}, bindings: "", slots: {}, events: {} }}
const Page__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type Page__SvelteComponent_ = InstanceType<typeof Page__SvelteComponent_>;
/*Ωignore_endΩ*/export default Page__SvelteComponent_;