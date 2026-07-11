///<reference types="svelte" />
;
import { classnames } from "@/utils";
import PaginationItem from "./PaginationItem.svelte";
import PaginationLink from "./PaginationLink.svelte";

;type $$ComponentProps =  {
    align?: "right" | "left" | "center";
    title?: string;
    count?: number;
    perPage?: number;
    currentPage?: number;
    baseUrl?: string;
    class?: string;
  };function $$render() {

  
  
  

  let {
    align = undefined,
    title = "Pagination",
    count = 0,
    perPage = 10,
    currentPage = $bindable(0),
    baseUrl = undefined,
    class: className = "",
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props()/*Ωignore_startΩ*/;currentPage;/*Ωignore_endΩ*/;

  // Should always be odd-numbered
  const pageItems = 5;

  let classes = $derived(
    classnames(
      "pagination",
      align ? ["d-flex", `justify-content-${{ right: "end", center: "center", left: "start" }[align]}`] : "",
      className
    )
  );

  let totalPages = $derived(Math.max(1, Math.ceil(count / perPage)));

  function pageFor(position: number): number | string {
    const pos = Math.min(
      Math.max(position, currentPage + (position - (pageItems - 1) / 2)),
      totalPages + position - pageItems
    );

    if (position === pageItems - 1 && pos + 1 < totalPages) {
      return "…";
    }

    if (position === 0 && pos > 0) {
      return "…";
    }

    return pos;
  }
;
async () => {

 { svelteHTML.createElement("ul", {   "class":classes,"aria-label":title,});
   { const $$_metInoitanigaP1C = __sveltets_2_ensureComponent(PaginationItem); new $$_metInoitanigaP1C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"disabled":currentPage === 0,}});
     { const $$_kniLnoitanigaP2C = __sveltets_2_ensureComponent(PaginationLink); new $$_kniLnoitanigaP2C({ target: __sveltets_2_any(), props: {      "first":true,"href":baseUrl ? `${baseUrl}/1` : "#first","onclick":(e) => {
        e.preventDefault();
        currentPage = 0;
      },}});}
   PaginationItem}
   { const $$_metInoitanigaP1C = __sveltets_2_ensureComponent(PaginationItem); new $$_metInoitanigaP1C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"disabled":currentPage === 0,}});
     { const $$_kniLnoitanigaP2C = __sveltets_2_ensureComponent(PaginationLink); new $$_kniLnoitanigaP2C({ target: __sveltets_2_any(), props: {      "previous":true,"href":baseUrl ? `${baseUrl}/${currentPage}` : "#previous","onclick":(e) => {
        e.preventDefault();
        currentPage -= 1;
      },}});}
   PaginationItem}
      for(let _ of __sveltets_2_ensureArray(Array(pageItems))){let position = 1;pageFor(position) + "_" + position;
    if(!(pageFor(position) < 0)){
       { const $$_metInoitanigaP1C = __sveltets_2_ensureComponent(PaginationItem); new $$_metInoitanigaP1C({ target: __sveltets_2_any(), props: {     children:() => { return __sveltets_2_any(0); },"disabled":typeof pageFor(position) !== "number","active":pageFor(position) === currentPage,}});
         { const $$_kniLnoitanigaP2C = __sveltets_2_ensureComponent(PaginationLink); new $$_kniLnoitanigaP2C({ target: __sveltets_2_any(), props: {       children:() => { return __sveltets_2_any(0); },"href":baseUrl ? `${baseUrl}/${+pageFor(position) + 1}` : "#","onclick":!baseUrl
            ? (e) => {
                e.preventDefault();
                currentPage = +pageFor(position);
              }
            : () => {},"arialabel":typeof pageFor(position) === "number" ? `Go to page ${+pageFor(position) + 1}` : undefined,}});
          typeof pageFor(position) === "number" ? +pageFor(position) + 1 : pageFor(position);
         PaginationLink}
       PaginationItem}
    }
  }
   { const $$_metInoitanigaP1C = __sveltets_2_ensureComponent(PaginationItem); new $$_metInoitanigaP1C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"disabled":currentPage === totalPages - 1,}});
     { const $$_kniLnoitanigaP2C = __sveltets_2_ensureComponent(PaginationLink); new $$_kniLnoitanigaP2C({ target: __sveltets_2_any(), props: {      "next":true,"href":baseUrl ? `${baseUrl}/${currentPage + 2}` : "#next","onclick":(e) => {
        e.preventDefault();
        currentPage += 1;
      },}});}
   PaginationItem}
   { const $$_metInoitanigaP1C = __sveltets_2_ensureComponent(PaginationItem); new $$_metInoitanigaP1C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"disabled":currentPage === totalPages - 1,}});
     { const $$_kniLnoitanigaP2C = __sveltets_2_ensureComponent(PaginationLink); new $$_kniLnoitanigaP2C({ target: __sveltets_2_any(), props: {      "last":true,"href":baseUrl ? `${baseUrl}/${totalPages}` : "#last","onclick":(e) => {
        e.preventDefault();
        currentPage = totalPages - 1;
      },}});}
   PaginationItem}
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings('currentPage'), slots: {}, events: {} }}
const Pagination__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Pagination__SvelteComponent_ = ReturnType<typeof Pagination__SvelteComponent_>;
/*Ωignore_endΩ*/export default Pagination__SvelteComponent_;