///<reference types="svelte" />
;
import type { Page as IPage } from "@bgs/models";
import Page from "@/components/Page.svelte";
import { SEO } from "@/components";
import removeMarkdown from "remove-markdown";

;type $$ComponentProps =  { data: { pageContent: Partial<IPage> } };function $$render() {

  
  
  
  

  let { data }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

 { const $$_OES0C = __sveltets_2_ensureComponent(SEO); new $$_OES0C({ target: __sveltets_2_any(), props: {     "title":data.pageContent.title,"description":removeMarkdown(`${data.pageContent.content}`.match(/((\s*\S+){0,40})([\s\S]*)/)[1]) + "...",}});}

 { const $$_egaP0C = __sveltets_2_ensureComponent(Page); new $$_egaP0C({ target: __sveltets_2_any(), props: {  "pageContent":data.pageContent,}});}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Page__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Page__SvelteComponent_ = ReturnType<typeof Page__SvelteComponent_>;
/*Ωignore_endΩ*/export default Page__SvelteComponent_;