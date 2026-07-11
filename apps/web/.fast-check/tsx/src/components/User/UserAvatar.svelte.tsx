///<reference types="svelte" />
;
import { browser } from "$app/environment";

import { imageCache } from "@/lib/stores.svelte";
import { getAccessToken } from "@/lib/api";
function $$render() { let $$restProps = __sveltets_2_restPropsType();
/*Ωignore_startΩ*/;let $imageCache = __sveltets_2_store_get(imageCache);/*Ωignore_endΩ*/
  

  
  

   let userId: string | null = null/*Ωignore_startΩ*/;userId = __sveltets_2_any(userId);/*Ωignore_endΩ*/;
   let username: string/*Ωignore_startΩ*/;username = __sveltets_2_any(username);/*Ωignore_endΩ*/;
   let art = "pixel-art";

   let size = "4rem";

  let src: string;
  let token: string;

  if (browser) {
    getAccessToken("/api/account/avatar").then((res) => (token = res?.code!));
  }

  $: src =
    __sveltets_2_invalidate(() => userId === "me"
      ? `/api/account/avatar?d=${$imageCache}&token=${encodeURIComponent(token)}`
      : userId
        ? `/api/user/${userId}/avatar?d=${$imageCache}`
        : `https://avatars.dicebear.com/api/${art}/${username}.svg?r=0`);
;
async () => {

  { svelteHTML.createElement("img", {                 src,"srcset":`${src}&size=256 256w, ${src}&size=128 128w, ${src}&size=64 64w`,"sizes":size,"style":`height: ${size}; width: $${size}`,"alt":`${username}'s avatar`,"title":username,"class":`user-avatar`,...$$restProps,"on:click":undefined,"on:error":undefined,"on:load":undefined,});}


};
return { props: {userId: userId , username: username , art: art , size: size} as {userId?: string | null, username: string, art?: typeof art, size?: typeof size}, exports: {}, bindings: "", slots: {}, events: {'click':__sveltets_2_mapElementEvent('click'), 'error':__sveltets_2_mapElementEvent('error'), 'load':__sveltets_2_mapElementEvent('load')} }}
const UserAvatar__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any(__sveltets_2_with_any_event($$render())));
/*Ωignore_startΩ*/type UserAvatar__SvelteComponent_ = InstanceType<typeof UserAvatar__SvelteComponent_>;
/*Ωignore_endΩ*/export default UserAvatar__SvelteComponent_;