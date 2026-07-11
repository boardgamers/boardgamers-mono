///<reference types="svelte" />
;
import { handleError, confirm, niceDate, duration, createWatcher } from "@/utils";
import { Card, Button, Col, Container, FormGroup, Input, InputGroup, Row, Checkbox } from "@/modules/cdk";
import { upperFirst, debounce } from "lodash";
import { account } from "@/lib/account.svelte";
import { post, apiFetch } from "@/lib/api";
import type { IUser } from "@bgs/models";
import { browser } from "$app/environment";
import { developerSettings } from "@/lib/stores.svelte";
import { useLoggedIn } from "@/lib/auth-guards.svelte";
import UserAvatar from "@/components/User/UserAvatar.svelte";
import { logoClick, imageCache } from "@/lib/stores.svelte";
function $$render() {
/*Ωignore_startΩ*/;let $account = __sveltets_2_store_get(account);;let $developerSettings = __sveltets_2_store_get(developerSettings);/*Ωignore_endΩ*/
  
  
  
  
  
  
  
  
  
  
  

  useLoggedIn();

  let email = $account!.account.email;
  let editingEmail = false;
  let notifications = browser ? !!localStorage.getItem("notifications") : false;
  let newsletter = $account!.settings?.mailing?.newsletter;
  let soundNotification = $account!.settings?.game?.soundNotification;
  let gameNotification = $account!.settings?.mailing?.game?.activated;
  let gameNotificationDelay = $account!.settings?.mailing?.game?.delay ?? 30 * 60;
  let tc = false;
  let editingAvatar = false;
  let fileUpload: HTMLInputElement;

  let  bio = __sveltets_2_invalidate(() => $account?.account.bio ?? "");

  const avatarStyles = [
    "adventurer",
    "adventurer-neutral",
    "avataaars",
    "big-ears",
    "big-ears-neutral",
    "big-smile",
    "bottts",
    "croodles",
    "croodles-neutral",
    "gridy",
    "identicon",
    "initials",
    "jdenticon",
    "micah",
    "miniavs",
    "open-peeps",
    "personas",
    "pixel-art",
    "pixel-art-neutral",
  ];

  async function acceptTC() {
    const accepted = await confirm("The terms and conditions will be marked as accepted at today's date.");

    if (!accepted) {
      tc = false;
      return;
    }

    try {
      account.set(await post("/account/terms-and-conditions"));
    } catch (err) {
      handleError(err);
    }
  }

  const selectArt = (art: string) =>
    post<IUser>("/account", {
      account: {
        avatar: art,
      },
    })
      .then((r) => account.set(r), handleError)
      .finally(() => (((editingAvatar = false), imageCache.set(Date.now())), logoClick()));

  const updateAccount = debounce(
    () => {
      post<IUser>("/account", {
        settings: {
          mailing: {
            newsletter,
            game: {
              activated: gameNotification,
              delay: gameNotificationDelay,
            },
          },
          game: {
            soundNotification,
          },
        },
      }).then((r) => account.set(r), handleError);
    },
    800,
    { leading: false }
  );

  const updateBio = (bio: string) =>
    post<IUser>("/account", {
      account: {
        bio,
      },
    }).then((r) => account.set(r), handleError);

  async function saveEmail() {
    try {
      account.set(await post("/account/email", { email }));
    } catch (err) {
      handleError(err);
    }
  }

  const onNotificationsChanged = createWatcher(() => {
    if (notifications) {
      if (Notification.permission !== "granted") {
        Notification.requestPermission();
      }
    }

    if (!!localStorage.getItem("notifications") !== notifications) {
      localStorage.setItem("notifications", notifications ? "1" : "");
    }
  });

  let customAvatarError = false;

  async function uploadAvatar(event: InputEvent) {
    const file = (event.target as HTMLInputElement).files?.[0];

    if (!file) {
      return;
    }

    const resp = await apiFetch("/account/avatar", { method: "POST", body: file });
    if (!resp.ok) {
      handleError("Error during upload (" + resp.status + ")");
      return;
    }
    imageCache.set(Date.now());
    editingAvatar = false;
    customAvatarError = false;
  }

  ;() => {$: (onNotificationsChanged(), [notifications]);}
;
async () => {

 { svelteHTML.createElement("svelte:head", {});
   { svelteHTML.createElement("title", {});  }
 }

 { const $$_reniatnoC0C = __sveltets_2_ensureComponent(Container); new $$_reniatnoC0C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
   { const $$_woR1C = __sveltets_2_ensureComponent(Row); new $$_woR1C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
     { const $$_loC2C = __sveltets_2_ensureComponent(Col); new $$_loC2C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
       { svelteHTML.createElement("h1", {});$account.account.username; }
     Col}
     { const $$_loC2C = __sveltets_2_ensureComponent(Col); new $$_loC2C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"class":`text-end`,}});
       { svelteHTML.createElement("a", {     "class":`btn btn-primary`,"href":`/user/${$account.account.username}`,"role":`button`,});  }
     Col}
   Row}

   { const $$_draC1C = __sveltets_2_ensureComponent(Card); new $$_draC1C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"class":`mt-4 border-accent`,"header":`User Settings`,}});
    if(!editingAvatar){
       { const $$_ratavAresU2C = __sveltets_2_ensureComponent(UserAvatar); const $$_ratavAresU2 = new $$_ratavAresU2C({ target: __sveltets_2_any(), props: {           ...__sveltets_2_cssProp({"--avatar-border":`1px solid gray`}),"role":`button`,"userId":$account._id,"username":$account.account.username,}});$$_ratavAresU2.$on("click", () => (editingAvatar = true));}
    }else{
       { const $$_input2 = svelteHTML.createElement("input", {         "type":`file`,"on:change":uploadAvatar,"accept":`image/*`,"class":`d-none`,});fileUpload = $$_input2;}
       { svelteHTML.createElement("a", {       "href":`#upload`,"style":`width: 100%`,"role":`button`,"on:click":() => fileUpload.click(),});  }
       { svelteHTML.createElement("div", {  "style":`display: contents`,});customAvatarError;
         { const $$_ratavAresU3C = __sveltets_2_ensureComponent(UserAvatar); const $$_ratavAresU3 = new $$_ratavAresU3C({ target: __sveltets_2_any(), props: {             "userId":`me`,"username":`Custom avatar`,"role":`button`,}});$$_ratavAresU3.$on("error", () => (customAvatarError = true));$$_ratavAresU3.$on("load", () => (customAvatarError = false));$$_ratavAresU3.$on("click", () => selectArt("upload"));}
       }
        for(let art of __sveltets_2_ensureArray(avatarStyles)){
         { const $$_ratavAresU2C = __sveltets_2_ensureComponent(UserAvatar); const $$_ratavAresU2 = new $$_ratavAresU2C({ target: __sveltets_2_any(), props: {       art,"username":$account.account.username,"role":`button`,}});$$_ratavAresU2.$on("click", () => selectArt(art));}
      }
    }
     { const $$_puorGmroF2C = __sveltets_2_ensureComponent(FormGroup); new $$_puorGmroF2C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"class":`mt-2`,}});
       { svelteHTML.createElement("label", { "for":`bio`,});  }
       { const $$_tupnI3C = __sveltets_2_ensureComponent(Input); const $$_tupnI3 = new $$_tupnI3C({ target: __sveltets_2_any(), props: {           "type":`textarea`,"id":`bio`,"placeholder":`Something about yourself...`,"value":bio,}});$$_tupnI3.$on("change", (event) => updateBio(event.target.value));}
     FormGroup}
     { const $$_puorGmroF2C = __sveltets_2_ensureComponent(FormGroup); new $$_puorGmroF2C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"class":`mt-2`,}});
       { svelteHTML.createElement("label", { "for":`email`,});  }
       { const $$_puorGtupnI3C = __sveltets_2_ensureComponent(InputGroup); new $$_puorGtupnI3C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
         { const $$_tupnI4C = __sveltets_2_ensureComponent(Input); const $$_tupnI4 = new $$_tupnI4C({ target: __sveltets_2_any(), props: {             "type":`email`,"id":`email`,"placeholder":`Email address`,value:email,"disabled":!editingEmail,}});/*Ωignore_startΩ*/() => email = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_tupnI4.$$bindings = 'value';$$_tupnI4.$on("keyup", (e) => {
            if (e.code === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              saveEmail();
            }
          });}

        if(!editingEmail){
           { const $$_nottuB4C = __sveltets_2_ensureComponent(Button); const $$_nottuB4 = new $$_nottuB4C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"outline":true,"color":`secondary`,}});$$_nottuB4.$on("click", () => (editingEmail = true));  Button}
        }else{
           { const $$_nottuB4C = __sveltets_2_ensureComponent(Button); const $$_nottuB4 = new $$_nottuB4C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"outline":true,"color":`success`,}});$$_nottuB4.$on("click", saveEmail);  Button}
        }
       InputGroup}
       { svelteHTML.createElement("small", {});$account.security.confirmed ? "Your email is confirmed." : "Your email is not confirmed."; }
     FormGroup}
     { svelteHTML.createElement("p", {});
       

        for(let social of __sveltets_2_ensureArray((["google", "discord", "facebook"]))){
         { svelteHTML.createElement("a", {            "class":`btn btn-secondary mx-1 ${social}`,"href":`/api/account/auth/${social}`,"aria-disabled":!!($account.account.social && $account.account.social[social]),"role":`button`,"rel":`external`,});!!($account.account.social && $account.account.social[social]);
          upperFirst(social);
         }
      }
     }
    if(!$account.account.termsAndConditions){
       { const $$_xobkcehC2C = __sveltets_2_ensureComponent(Checkbox); const $$_xobkcehC2 = new $$_xobkcehC2C({ target: __sveltets_2_any(), props: {      children:() => { return __sveltets_2_any(0); },checked:tc,"class":`mb-3`,}});/*Ωignore_startΩ*/() => tc = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_xobkcehC2.$$bindings = 'checked';$$_xobkcehC2.$on("change", acceptTC);
             { svelteHTML.createElement("a", { "href":`/page/terms-and-conditions`,});   } 
       Checkbox}
    }else{
       { svelteHTML.createElement("p", {});
            { svelteHTML.createElement("a", { "href":`/page/terms-and-conditions`,});   } 
        niceDate($account.account.termsAndConditions);
       }
    }
     { svelteHTML.createElement("hr", {});}
     { const $$_xobkcehC2C = __sveltets_2_ensureComponent(Checkbox); const $$_xobkcehC2 = new $$_xobkcehC2C({ target: __sveltets_2_any(), props: {    children:() => { return __sveltets_2_any(0); },checked:newsletter,}});/*Ωignore_startΩ*/() => newsletter = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_xobkcehC2.$$bindings = 'checked';$$_xobkcehC2.$on("change", updateAccount);        Checkbox}
     { svelteHTML.createElement("div", { "class":`form-row align-items-center`,});
       { svelteHTML.createElement("div", { "class":`col-auto`,});
         { const $$_xobkcehC4C = __sveltets_2_ensureComponent(Checkbox); const $$_xobkcehC4 = new $$_xobkcehC4C({ target: __sveltets_2_any(), props: {    children:() => { return __sveltets_2_any(0); },checked:gameNotification,}});/*Ωignore_startΩ*/() => gameNotification = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_xobkcehC4.$$bindings = 'checked';$$_xobkcehC4.$on("change", updateAccount);
                    
         Checkbox}
       }
       { svelteHTML.createElement("div", { "class":`col-auto`,});
         { svelteHTML.createElement("select", {       "class":`form-control form-control-sm`,"bind:value":gameNotificationDelay,"on:blur":() => {
            gameNotification = true;
            updateAccount();
          },});/*Ωignore_startΩ*/() => gameNotificationDelay = __sveltets_2_any(null);/*Ωignore_endΩ*/
            for(let seconds of __sveltets_2_ensureArray(([60, 5 * 60, 10 * 60, 30 * 60, 2 * 3600, 6 * 3600, 12 * 3600]))){
             { svelteHTML.createElement("option", { "value":seconds,});
              duration(seconds);
             }
          }
         }
       }
     }
     { svelteHTML.createElement("hr", {});}
     { const $$_xobkcehC2C = __sveltets_2_ensureComponent(Checkbox); const $$_xobkcehC2 = new $$_xobkcehC2C({ target: __sveltets_2_any(), props: {  children:() => { return __sveltets_2_any(0); },checked:$developerSettings,}});/*Ωignore_startΩ*/() => $developerSettings = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_xobkcehC2.$$bindings = 'checked';       Checkbox}
   Card}
   { const $$_draC1C = __sveltets_2_ensureComponent(Card); new $$_draC1C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"class":`mt-4 border-accent`,"header":`Game Settings`,}});
     { const $$_xobkcehC2C = __sveltets_2_ensureComponent(Checkbox); const $$_xobkcehC2 = new $$_xobkcehC2C({ target: __sveltets_2_any(), props: {    children:() => { return __sveltets_2_any(0); },checked:soundNotification,}});/*Ωignore_startΩ*/() => soundNotification = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_xobkcehC2.$$bindings = 'checked';$$_xobkcehC2.$on("change", updateAccount);
                 
     Checkbox}
     { const $$_xobkcehC2C = __sveltets_2_ensureComponent(Checkbox); const $$_xobkcehC2 = new $$_xobkcehC2C({ target: __sveltets_2_any(), props: {  children:() => { return __sveltets_2_any(0); },checked:notifications,}});/*Ωignore_startΩ*/() => notifications = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_xobkcehC2.$$bindings = 'checked';        Checkbox}
   Card}
 Container}
};
return { props: {} as Record<string, never>, exports: {}, bindings: "", slots: {}, events: {} }}
const Page__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type Page__SvelteComponent_ = InstanceType<typeof Page__SvelteComponent_>;
/*Ωignore_endΩ*/export default Page__SvelteComponent_;