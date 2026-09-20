<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
const props=defineProps({modelValue:[String,Number],options:{type:Array,required:true},label:String,disabled:Boolean})
const emit=defineEmits(['update:modelValue'])
const trigger=ref(null), menu=ref(null), opened=ref(false), position=ref({})
const selected=computed(()=>props.options.find(o=>o.value===props.modelValue)?.label || props.label)
async function open() {
  if(props.disabled)return
  if(opened.value){close();return}
  const rect=trigger.value.getBoundingClientRect()
  const below=window.innerHeight-rect.bottom-8, above=rect.top-8
  const up=below<180 && above>below
  position.value={left:Math.max(8,Math.min(rect.left,window.innerWidth-288))+'px',width:Math.min(Math.max(rect.width,220),window.innerWidth-16)+'px',maxHeight:Math.max(60,Math.min(320,up?above:below))+'px',...(up?{bottom:window.innerHeight-rect.top+2+'px'}:{top:rect.bottom+2+'px'})}
  opened.value=true
  await nextTick()
  const buttons=menu.value?.querySelectorAll('button')
  const index=Math.max(0,props.options.findIndex(o=>o.value===props.modelValue))
  buttons?.[index]?.focus({preventScroll:true})
  buttons?.[index]?.scrollIntoView({block:'nearest'})
}
function close(focus=false){opened.value=false;if(focus)trigger.value?.focus()}
function choose(value){emit('update:modelValue',value);close(true)}
function outside(event){if(!trigger.value?.contains(event.target) && !menu.value?.contains(event.target))close()}
function keyboard(event) {
  if(event.key==='Escape'){event.preventDefault();close(true);return}
  if(event.key==='Tab'){close();return}
  const buttons=[...menu.value.querySelectorAll('button')]
  let index=buttons.indexOf(document.activeElement)
  if(event.key==='ArrowDown')index=(index+1)%buttons.length
  else if(event.key==='ArrowUp')index=(index-1+buttons.length)%buttons.length
  else if(event.key==='Home')index=0
  else if(event.key==='End')index=buttons.length-1
  else return
  event.preventDefault();buttons[index]?.focus()
}
const resized=()=>close()
onMounted(()=>{document.addEventListener('click',outside);window.addEventListener('resize',resized)})
onBeforeUnmount(()=>{document.removeEventListener('click',outside);window.removeEventListener('resize',resized)})
</script>

<template>
  <button ref="trigger" type="button" class="forum-select" :disabled="disabled" :aria-label="label" aria-haspopup="listbox" :aria-expanded="opened" @click="open" @keydown.down.prevent="!opened && open()" @keydown.up.prevent="!opened && open()">{{ selected }} <span aria-hidden="true">▾</span></button>
  <Teleport to="body">
    <div v-if="opened" ref="menu" class="forum-select-menu" role="listbox" :aria-label="label" :style="position" @keydown="keyboard">
      <button v-for="option in options" :key="option.value" type="button" role="option" :aria-selected="option.value===modelValue" @click="choose(option.value)">{{ option.label }}</button>
    </div>
  </Teleport>
</template>

<style>
.forum-select {display:inline-flex;align-items:center;justify-content:space-between;gap:12px;max-width:240px;min-height:21px;padding:1px 5px;border:1px solid #a7b6c2;border-radius:0;color:#344f60;background:#fff;font:inherit;text-align:left;touch-action:manipulation}
.forum-select-menu {position:fixed;z-index:10000;overflow-y:auto;overscroll-behavior:contain;border:1px solid #8fb6d5;background:white;box-shadow:0 3px 9px #0003;padding:3px;font:12px SimSun,Arial,sans-serif}
.forum-select-menu button {display:block;width:100%;min-height:32px;padding:7px 9px;border:0;background:white;color:#344f60;text-align:left;font:inherit;touch-action:manipulation}
.forum-select-menu button[aria-selected=true] {background:#dfedf9;color:#126aab;font-weight:bold}
.forum-select-menu button:focus,.forum-select-menu button:hover {background:#c9e5fa;outline:1px solid #80acd2}
@media (pointer:coarse) {.forum-select,.list-filters .forum-select {min-height:36px}.forum-select-menu button {min-height:44px;font-size:14px}}
</style>
