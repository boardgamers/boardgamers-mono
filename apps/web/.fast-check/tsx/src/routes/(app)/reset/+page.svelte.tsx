///<reference types="svelte" />
;
import { page } from "$app/stores";
import { SEO } from "@/components";
import { setAuthData, type AuthData } from "@/lib/auth.svelte";
import { post } from "@/lib/api";
import { handleError, handleInfo } from "@/utils";
function $$render() {
/*Ωignore_startΩ*/;let $page = __sveltets_2_store_get(page);/*Ωignore_endΩ*/
  
  
  
  
  

  async function resetPassword(params: { email: string; resetKey: string; password: string }): Promise<void> {
    return post<AuthData>("/account/reset", params).then(setAuthData);
  }

  let email = $page.url.searchParams.get("email") ?? $page.url.searchParams.get("user") ?? "";
  let key = $page.url.searchParams.get("key")!;
  let password = "";
  let passwordConfirm = "";

  function handleSubmit() {
    if (password !== passwordConfirm) {
      handleError("The passwords don't match");
      return;
    }
    resetPassword({ email, resetKey: key, password }).then(() => handleInfo("Your password was reset"), handleError);
  }
;
async () => {

 { const $$_OES0C = __sveltets_2_ensureComponent(SEO); new $$_OES0C({ target: __sveltets_2_any(), props: {  "title":`Reset password`,}});}
 { svelteHTML.createElement("div", { "class":`goldfish container`,});
   { svelteHTML.createElement("h1", {});  }
   { svelteHTML.createElement("form", {         "method":`post`,"accept-charset":`UTF-8`,"role":`form`,"class":`clearfix`,"on:submit":handleSubmit,});
     { svelteHTML.createElement("div", { "class":`form-group`,});
       { svelteHTML.createElement("label", { "for":`email`,});  }
       { svelteHTML.createElement("input", {             "type":`email`,"class":`form-control`,"id":`email`,"placeholder":`Email address`,"bind:value":email,"disabled":true,"required":true,});/*Ωignore_startΩ*/() => email = __sveltets_2_any(null);/*Ωignore_endΩ*/}
     }
     { svelteHTML.createElement("div", { "class":`form-row`,});
       { svelteHTML.createElement("div", { "class":`form-group col-md-6`,});
         { svelteHTML.createElement("label", { "for":`signup-password`,});  }
         { svelteHTML.createElement("input", {            "type":`password`,"class":`form-control`,"id":`signup-password`,"placeholder":`Password`,"bind:value":password,"required":true,});/*Ωignore_startΩ*/() => password = __sveltets_2_any(null);/*Ωignore_endΩ*/}
       }
       { svelteHTML.createElement("div", { "class":`form-group col-md-6`,});
         { svelteHTML.createElement("label", { "for":`signup-password-confirm`,});  { svelteHTML.createElement("span", { "class":`d-md-none`,});  } }
         { svelteHTML.createElement("input", {            "type":`password`,"class":`form-control`,"id":`signup-password-confirm`,"bind:value":passwordConfirm,"placeholder":`Password`,"required":true,});/*Ωignore_startΩ*/() => passwordConfirm = __sveltets_2_any(null);/*Ωignore_endΩ*/}
       }
     }
     { svelteHTML.createElement("button", {   "type":`submit`,"class":`btn btn-primary pull-right mt-3`,});  }
   }
 }
};
return { props: {} as Record<string, never>, exports: {}, bindings: "", slots: {}, events: {} }}
const Page__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type Page__SvelteComponent_ = InstanceType<typeof Page__SvelteComponent_>;
/*Ωignore_endΩ*/export default Page__SvelteComponent_;