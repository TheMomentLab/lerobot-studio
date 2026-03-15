import{c as u}from"./index-B9jGaOh8.js";/**
 * @license lucide-react v0.487.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const l=[["path",{d:"M12 8V4H8",key:"hb8ula"}],["rect",{width:"16",height:"12",x:"4",y:"8",rx:"2",key:"enze0r"}],["path",{d:"M2 14h2",key:"vft8re"}],["path",{d:"M20 14h2",key:"4cs60a"}],["path",{d:"M15 13v2",key:"1xurst"}],["path",{d:"M9 13v2",key:"rq6x2g"}]],m=u("bot",l);function p(r){return r.replace(/_/g," ").replace(/\b\w/g,e=>e.toUpperCase())}function c(r){if(!r)return[2,0];const e=r.toLowerCase(),t=e.includes("leader")?0:e.includes("follower")?1:2,o=e.match(/(\d+)$/),n=o?Number(o[1]):0;return[t,n]}function d(r){return r.map(e=>{const t=e.path??`/dev/${e.device}`,o=e.symlink?`${p(e.symlink)}  (${t})`:t;return{value:t,label:o,_sym:e.symlink}}).sort((e,t)=>{const[o,n]=c(e._sym),[s,a]=c(t._sym);return o!==s?o-s:n-a}).map(({value:e,label:t})=>({value:e,label:t}))}export{m as B,d as b,p as s};
