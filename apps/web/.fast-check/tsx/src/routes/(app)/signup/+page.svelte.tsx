///<reference types="svelte" />
;
import { page } from "$app/stores";
import { SEO } from "@/components";
import { setAuthData, type AuthData } from "@/lib/auth.svelte";
import { useLoggedOut } from "@/lib/auth-guards.svelte";
import { post } from "@/lib/api";
import Checkbox from "@/modules/cdk/Checkbox.svelte";
import { handleError } from "@/utils";
import { upperFirst } from "lodash";
function $$render() {
/*Ωignore_startΩ*/;let $page = __sveltets_2_store_get(page);/*Ωignore_endΩ*/
  
  
  
  
  
  
  
  

  useLoggedOut();

  let email = $page.url.searchParams.get("user") ?? "";
  let isSocial = $page.url.searchParams.get("createSocialAccount");
  let provider = $page.url.searchParams.get("provider")!;

  let password = "";
  let passwordConfirm = "";
  let username = "";
  let newsletter = false;
  let tc = false;

  async function register(params: {
    email: string;
    username: string;
    password: string;
    newsletter: boolean;
    termsAndConditions: boolean;
  }): Promise<void> {
    return post<AuthData>("/account/signup", params).then(setAuthData);
  }

  async function registerSocial(params: { jwt: string; username: string; termsAndConditions: boolean }): Promise<void> {
    return post<AuthData>("/account/signup/social", params).then(setAuthData);
  }

  function handleSubmit() {
    if (!tc) {
      handleError("You need to read and agree to the Terms and Conditions!");
      return;
    }

    if (isSocial) {
      const jwt = $page.url.searchParams.get("jwt")!;

      registerSocial({ username, termsAndConditions: tc, jwt }).catch(handleError);
    } else {
      if (password !== passwordConfirm) {
        handleError("The two passwords don't match");
        return;
      }

      register({ email, password, newsletter, username, termsAndConditions: tc }).catch(handleError);
    }
  }
;
async () => {

 { const $$_OES0C = __sveltets_2_ensureComponent(SEO); new $$_OES0C({ target: __sveltets_2_any(), props: {  "title":`Create an account`,}});}

 { svelteHTML.createElement("div", { "class":`signup container`,});
   { svelteHTML.createElement("h1", {});   }
   { svelteHTML.createElement("form", {   "method":`post`,"on:submit":handleSubmit,});
     { svelteHTML.createElement("div", { "class":`form-group`,});
       { svelteHTML.createElement("label", { "for":`signup-username`,});  }
       { svelteHTML.createElement("input", {                "type":`text`,"class":`form-control`,"id":`signup-username`,"name":`username`,"placeholder":`Username`,"aria-describedby":`usernameHelp`,"bind:value":username,"required":true,});/*Ωignore_startΩ*/() => username = __sveltets_2_any(null);/*Ωignore_endΩ*/}
      if(isSocial){
         { svelteHTML.createElement("small", {   "id":`usernameHelp`,"class":`form-text text-muted`,});
                { svelteHTML.createElement("b", { "class":`text-${provider}`,}); upperFirst(provider); }      
                
         }
      }
     }
    if(!isSocial){
       { svelteHTML.createElement("div", { "class":`form-group`,});
         { svelteHTML.createElement("label", { "for":`signup-email`,});  }
         { svelteHTML.createElement("input", {                "type":`email`,"class":`form-control`,"id":`signup-email`,"name":`email`,"placeholder":`Email`,"aria-describedby":`emailHelp`,"bind:value":email,"required":true,});/*Ωignore_startΩ*/() => email = __sveltets_2_any(null);/*Ωignore_endΩ*/}
         { svelteHTML.createElement("small", {   "id":`emailHelp`,"class":`form-text text-muted`,});
                  { svelteHTML.createElement("b", {});  } 
         }
       }
       { svelteHTML.createElement("div", { "class":`form-row`,});
         { svelteHTML.createElement("div", { "class":`form-group col-md-6`,});
           { svelteHTML.createElement("label", { "for":`signup-password`,});  }
           { svelteHTML.createElement("input", {              "type":`password`,"class":`form-control`,"id":`signup-password`,"name":`password`,"placeholder":`Password`,"bind:value":password,"required":true,});/*Ωignore_startΩ*/() => password = __sveltets_2_any(null);/*Ωignore_endΩ*/}
         }
         { svelteHTML.createElement("div", { "class":`form-group col-md-6`,});
           { svelteHTML.createElement("label", { "for":`signup-password-confirm`,});  { svelteHTML.createElement("span", { "class":`d-md-none`,});  } }
           { svelteHTML.createElement("input", {              "type":`password`,"class":`form-control`,"id":`signup-password-confirm`,"name":`password-confirm`,"placeholder":`Password`,"bind:value":passwordConfirm,"required":true,});/*Ωignore_startΩ*/() => passwordConfirm = __sveltets_2_any(null);/*Ωignore_endΩ*/}
         }
       }
       { const $$_xobkcehC2C = __sveltets_2_ensureComponent(Checkbox); const $$_xobkcehC2 = new $$_xobkcehC2C({ target: __sveltets_2_any(), props: {  children:() => { return __sveltets_2_any(0); },checked:newsletter,}});/*Ωignore_startΩ*/() => newsletter = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_xobkcehC2.$$bindings = 'checked';        Checkbox}
    }

     { const $$_xobkcehC2C = __sveltets_2_ensureComponent(Checkbox); const $$_xobkcehC2 = new $$_xobkcehC2C({ target: __sveltets_2_any(), props: {  children:() => { return __sveltets_2_any(0); },checked:tc,}});/*Ωignore_startΩ*/() => tc = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_xobkcehC2.$$bindings = 'checked';
              { svelteHTML.createElement("a", {   "href":`/page/terms-and-conditions`,"target":`_blank`,});   }
     Checkbox}

     { svelteHTML.createElement("button", {     "id":`signup-button`,"class":`btn btn-primary pull-right mt-3`,"type":`submit`,});  }
   }

   { svelteHTML.createElement("hr", {});}

   { svelteHTML.createElement("p", {});     { svelteHTML.createElement("a", { "href":`/login`,});  } }
   { svelteHTML.createElement("p", {});   { svelteHTML.createElement("a", { "href":`/`,});  }  }
 }
};
return { props: {} as Record<string, never>, exports: {}, bindings: "", slots: {}, events: {} }}
const Page__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type Page__SvelteComponent_ = InstanceType<typeof Page__SvelteComponent_>;
/*Ωignore_endΩ*/export default Page__SvelteComponent_;