<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { archiveRequest } from './archive'
import { legacyTitle } from './legacy-title'
import digestIcon from './assets/digest-topic.png'
import ForumSelect from './ForumSelect.vue'

const posts = ref([])
const boards = ref([])
const stats = ref({ total_posts: 0, body_indexed: 0, year_min: '', year_max: '' })
const loading = ref(true)
const error = ref('')
const query = ref('')
const activeQuery = ref('')
const searchScope = ref('all')
const activeScope = ref('all')
const board = ref('')
const year = ref('2008')
const digest = ref('')
const legacyBoard = ref('')
const page = ref(1)
const total = ref(0)
const selected = ref(null)
const detailLoading = ref(false)
const pageSize = 30
let requestVersion=0
let detailVersion=0

const years = computed(() => {
  const first = Number(stats.value.year_min || 2005)
  const last = Number(stats.value.year_max || 2020)
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => String(last - i))
})
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const ratingsByFloor = computed(() => {
  const groups = {}
  for (const rating of selected.value?.ratings || []) {
    (groups[rating.floor] ||= []).push(rating)
  }
  return groups
})
const visiblePages = computed(() => {
  const start = Math.max(1, Math.min(page.value - 4, pageCount.value - 9))
  return Array.from({ length: Math.min(10, pageCount.value) }, (_, i) => start + i)
})
const rangeText = computed(() => total.value ? `${(page.value - 1) * pageSize + 1}–${Math.min(page.value * pageSize, total.value)}` : '0')

function apiUrl(path, params = {}) {
  const url = new URL(`/api${path}`, window.location.origin)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== '' && value != null) url.searchParams.set(key, value)
  })
  return url
}

async function fetchJson(url) {
  return archiveRequest(url)
}

async function loadPosts() {
  const version=++requestVersion
  loading.value = true
  error.value = ''
  try {
    const data = await fetchJson(apiUrl('/posts', {
      q: activeQuery.value, scope: activeScope.value, board: board.value, year: year.value, digest: digest.value,
      page: page.value, page_size: pageSize, legacy_board: legacyBoard.value,
    }))
    if(version!==requestVersion)return
    posts.value = data.items
    total.value = data.total
  } catch (err) {
    error.value = err.message
  } finally {
    if(version===requestVersion) loading.value = false
  }
}

function submitSearch() {
  activeQuery.value = query.value.trim()
  activeScope.value = searchScope.value
  page.value = 1
  loadPosts()
}

function clearFilters() {
  query.value = ''
  activeQuery.value = ''
  searchScope.value = activeScope.value = 'all'
  board.value = ''
  year.value = ''
  digest.value = ''
  legacyBoard.value = ''
  page.value = 1
  loadPosts()
}

async function openPost(post, threadPage = 1) {
  const version=++detailVersion
  error.value=''
  detailLoading.value = true
  selected.value = { ...post, thread_page: threadPage, replies_list: [] }
  window.location.hash = `post-${post.id}${threadPage > 1 ? '?page='+threadPage : ''}`
  try {
    const detail=await fetchJson(apiUrl(`/posts/${post.id}`,{page:threadPage}))
    if(version===detailVersion) {
      selected.value=detail
      history.replaceState(null,'',`#post-${detail.id}${detail.thread_page > 1 ? '?page='+detail.thread_page : ''}`)
    }
  } catch (err) {
    error.value = err.message
  } finally {
    if(version===detailVersion) detailLoading.value = false
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

function closePost() {
  detailVersion++
  selected.value = null
  history.replaceState(null, '', window.location.pathname + window.location.search)
  if(!posts.value.length) loadPosts()
}

function setPage(next) {
  if (next < 1 || next > pageCount.value) return
  page.value = next
  loadPosts()
  window.scrollTo({ top: 190, behavior: 'smooth' })
}

function formatDate(value) {
  return value ? value.replace('T', ' ').slice(0, 16) : '时间不详'
}

function titleParts(title) {
  title = legacyTitle(title).text
  const needle=activeQuery.value.toLowerCase()
  if(!needle)return [{text:title,match:false}]
  const parts=[];let offset=0;let position
  while((position=title.toLowerCase().indexOf(needle,offset))!==-1){
    parts.push({text:title.slice(offset,position),match:false},{text:title.slice(position,position+needle.length),match:true})
    offset=position+needle.length
  }
  parts.push({text:title.slice(offset),match:false})
  return parts
}

watch([board, year, digest, legacyBoard], () => { page.value = 1; loadPosts() })

onMounted(async () => {
  window.addEventListener('hashchange',()=>{
    const match=window.location.hash.match(/^#post-(\d+)(?:\?page=(\d+))?$/)
    if(match && (selected.value?.id!==Number(match[1]) || selected.value?.thread_page!==Number(match[2] || 1))) openPost({id:Number(match[1])},Number(match[2] || 1))
    else if(!match)closePost()
  })
  const linkedPost = window.location.hash.match(/^#post-(\d+)(?:\?page=(\d+))?$/)
  if (linkedPost) openPost({ id: Number(linkedPost[1]) },Number(linkedPost[2] || 1))
  try {
    const [boardData, statData] = await Promise.all([
      fetchJson(apiUrl('/boards')), fetchJson(apiUrl('/stats')),
    ])
    boards.value = boardData.items
    stats.value = statData
  } catch (err) {
    error.value = err.message
  }
  if (!linkedPost) await loadPosts()
})
</script>

<template>
  <header class="legacy-header">
    <button class="legacy-logo" @click="closePost" aria-label="返回论坛首页">
      <strong>步步高</strong><span>官方论坛</span>
    </button>
  </header>
  <nav class="main-nav" aria-label="主导航">
    <button :class="{ active: !selected }" @click="closePost">论坛首页</button>
    <button @click="closePost(); board = '学习机'">学习机专区</button>
    <button @click="closePost(); board = '点读机'">点读机专区</button>
    <button @click="closePost(); board = '校园内外'">校园内外</button>
    <button @click="closePost(); board = '意见建议'">意见建议</button>
    <span>{{ new Date().toLocaleDateString('zh-CN') }}</span>
  </nav>

  <main class="page-shell">
    <div class="breadcrumb"><button @click="closePost">步步高官方论坛</button><span>»</span><span>{{ selected ? selected.board : (board || '论坛首页') }}</span><span v-if="selected">» {{ legacyTitle(selected.title).text }}</span></div>

    <template v-if="!selected">
      <section class="legacy-list">
        <div class="list-announcement">历史帖子只读存档　{{ stats.year_min }}—{{ stats.year_max }}<span>◂ ▸</span></div>
        <div class="list-actions">
          <button class="new-topic" disabled title="历史存档不支持发帖">发表新帖</button>
          <span>{{ board || '全部版块' }}　|　{{ activeQuery ? `搜索：${activeQuery}` : '帖子列表' }}　|　按发表时间排序</span>
        </div>
        <form class="list-filters" @submit.prevent="submitSearch">
          <ForumSelect v-model="digest" label="精华筛选" :options="[{value:'',label:'全部主题'},{value:'1',label:'历史精华'}]" />
          <ForumSelect v-model="legacyBoard" label="原论坛板块" :options="[{value:'',label:'原论坛板块：不限'},{value:'38',label:'编程区（全部线索）'},{value:'snapshot',label:'编程区（旧快照确认）'},{value:'link',label:'编程区（旧链接推定）'}]" />
          <ForumSelect v-model="searchScope" label="搜索范围" :options="[{value:'all',label:'全部内容'},{value:'title',label:'只搜标题'},{value:'author',label:'只搜作者'},{value:'body',label:'只搜正文（首帖）'}]" />
          <ForumSelect v-model="board" label="论坛版块" :options="[{value:'',label:'全部版块'},...boards.map(item=>({value:item.board,label:item.board+' ('+item.count+')'}))]" />
          <ForumSelect v-model="year" label="年份" :options="[{value:'',label:'全部年份'},...years.map(item=>({value:item,label:item+' 年'}))]" />
          <input v-model="query" aria-label="搜索关键词" :placeholder="{ all: '标题、作者、正文', title: '输入标题关键词', author: '输入作者名称', body: '输入首帖正文关键词' }[searchScope]" />
          <button type="submit">站内搜索</button>
          <button v-if="activeQuery || board || year || digest || legacyBoard" type="button" @click="clearFilters">全部主题</button>
        </form>
        <section class="list-table-wrap" aria-label="帖子列表">
          <div v-if="loading" class="state">正在翻阅旧帖……</div>
          <div v-else-if="error" class="state error">{{ error }}</div>
          <div v-else-if="!posts.length" class="state">没有找到相关帖子，换个关键词试试。</div>
          <table v-else class="legacy-topic-table">
            <colgroup><col class="status-col" /><col /><col class="author-col" /><col class="counts-col" /><col class="updated-col" /></colgroup>
            <thead><tr><th scope="col">状态</th><th scope="col">主题</th><th scope="col">作者</th><th scope="col">回复 / 人气</th><th scope="col">最后更新</th></tr></thead>
            <tbody>
              <tr class="topic-divider"><td colspan="5">-= {{ digest ? '历史精华' : '主题列表' }} =-</td></tr>
              <tr v-for="post in posts" :key="post.id">
                <td class="status-cell"><img v-if="post.digest" :src="digestIcon" class="digest-icon" alt="历史精华" :title="post.digest.source === 'user_confirmed' ? '历史精华：用户确认补录' : post.digest.source === 'collection' ? '历史精华：精华汇总帖收录' : post.digest.source === 'screenshot_confirmed' ? '历史精华：旧论坛截图确认' : post.digest.source === 'candidate_review' ? '历史精华：候选审核补录，非系统标记' : `历史精华：${post.digest.snapshot} 快照有系统加精标记`" /><span v-if="post.rating_count" class="rating-badge" :title="`有 ${post.rating_count} 条评分记录，不代表精华`">评</span><span v-if="!post.digest && !post.rating_count" class="old-document" role="img" aria-label="存档主题" title="精华状态未知"></span></td>
                <td class="subject-cell"><span class="topic-expand" aria-hidden="true"></span><a :href="`#post-${post.id}`" target="_blank" rel="noopener" :style="{ color: legacyTitle(post.title).color }" :title="`${legacyTitle(post.title).text}（新标签页打开）`"><template v-for="(part,i) in titleParts(post.title)" :key="i"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></a><small v-if="!board">[{{ post.board }}]</small><small v-if="post.legacy_board">[编程区·{{ post.legacy_board.source === 'snapshot' ? '快照确认' : '链接推定' }}]</small></td>
                <td class="list-author"><span>{{ post.author || '匿名会员' }}</span><time :datetime="post.publish_time">{{ post.publish_time?.slice(0, 10) || '时间不详' }}</time></td>
                <td class="list-counts" title="原帖回复量和人气尚未收录"><span>{{ post.replies ?? '—' }}</span> / {{ post.views ?? '—' }}</td>
                <td class="list-updated" title="原帖最后更新时间尚未收录"><time>{{ post.last_update ? formatDate(post.last_update) : '—' }}</time><span>by: {{ post.last_author || '—' }}</span></td>
              </tr>
            </tbody>
          </table>
        </section>
        <nav class="list-pagination" aria-label="帖子列表分页">
          <span>总数 {{ total }}</span>
          <button v-if="page > 1" @click="setPage(page - 1)">上一页</button>
          <button v-if="visiblePages[0] > 1" @click="setPage(1)">1 …</button>
          <button v-for="item in visiblePages" :key="item" :class="{ current: item === page }" :aria-current="item === page ? 'page' : undefined" @click="setPage(item)">{{ item }}</button>
          <button :disabled="page === pageCount" @click="setPage(page + 1)">下一页</button>
          <button v-if="visiblePages[visiblePages.length - 1] < pageCount" @click="setPage(pageCount)">…{{ pageCount }}</button>
        </nav>
        <div class="list-legend"><b>论坛图例说明</b><div><span class="old-document" aria-hidden="true"></span>存档主题　<img :src="digestIcon" class="digest-icon" alt="历史精华" /> 历史精华<span class="legend-note">包含旧快照、截图确认、精华汇总帖、候选审核与用户确认补录，来源见帖子详情；无标记为未知，不表示非精华。</span></div></div>
      </section>
    </template>

    <article v-else class="post-page">
      <div class="post-toolbar"><button @click="closePost">↩ 回到主题列表</button><span>已存档 {{ selected.total_floors || 0 }} 个楼层　主题编号：{{ selected.post_id }}</span></div>
      <div v-if="selected.thread_pages?.length > 1" class="list-pagination" role="navigation" aria-label="主题存档分页">
        <button :disabled="detailLoading || selected.thread_page <= 1" @click="openPost(selected, selected.thread_page - 1)">上一页</button>
        <div>存档分页 <ForumSelect :model-value="selected.thread_page" :disabled="detailLoading" label="存档分页" :options="selected.thread_pages.map((number,i)=>({value:i+1,label:'第 '+number+' 页'}))" @update:model-value="openPost(selected, $event)" /> / {{ selected.thread_pages.length }} 页</div>
        <button :disabled="detailLoading || selected.thread_page >= selected.thread_pages.length" @click="openPost(selected, selected.thread_page + 1)">下一页</button>
      </div>
      <header class="post-title"><span>主题：</span><h1 :style="{ color: legacyTitle(selected.title).color }">{{ legacyTitle(selected.title).text }}</h1><small>[{{ selected.board }}]</small></header>
      <div v-if="selected.legacy_board" class="digest-notice">原论坛板块：编程区（boardid=38）。<template v-if="selected.legacy_board.source === 'snapshot'">旧快照确认：{{ selected.legacy_board.snapshot }}。</template><template v-else>旧链接推定，可能存在迁版或链接参数不准确的情况。依据：<a :href="`#post-${selected.legacy_board.record_id}?page=${selected.legacy_board.page || 1}`" target="_blank" rel="noopener">存档记录 {{ selected.legacy_board.record_id }} 第 {{ selected.legacy_board.page || 1 }} 页的第 {{ selected.legacy_board.floor }} 个楼层</a>。</template>保留新版分类不变；未标记不表示不属于编程区。</div>
      <div v-if="selected.digest" class="digest-notice">
        <template v-if="selected.digest.source === 'candidate_review'">历史精华 · 候选审核补录（非系统标记，依据本帖加精表述）。
          <details><summary>查看补录依据</summary><p v-for="(item,i) in selected.digest.evidence" :key="i">{{ item.floor }} 楼 · {{ item.author }} · {{ item.time }}：{{ item.context }}</p></details>
        </template>
        <template v-else-if="selected.digest.source === 'screenshot_confirmed'">历史精华 · 旧论坛截图确认。{{ selected.digest.evidence_note }}</template>
        <template v-else-if="selected.digest.source === 'user_confirmed'">历史精华 · 用户确认补录。{{ selected.digest.evidence_note }}</template>
        <template v-else-if="selected.digest.source === 'collection'">历史精华 · 精华汇总帖收录。来源：<a :href="`#post-${selected.digest.collection_id}`" target="_blank" rel="noopener">《{{ selected.digest.collection_title }}》第 {{ selected.digest.floor }} 楼</a>。</template>
        <template v-else>本帖曾被加为精华（历史快照：{{ selected.digest.snapshot }}）。仅表示该快照时的状态。</template>
      </div>
      <div v-if="detailLoading" class="state">正在打开旧帖……</div>
      <div v-else-if="error" class="state error">{{ error }}</div>
      <template v-else>
        <section v-for="(reply, index) in selected.replies_list" :key="reply.pid || index" class="post-floor">
          <aside>
            <div class="user-name-bar">{{ reply.author || '匿名会员' }}</div>
            <div class="avatar">
              <span>{{ (reply.author || '?').slice(0, 1) }}</span>
              <img v-if="reply.avatar_url" :class="{ 'default-avatar': reply.is_default_avatar }" :src="reply.avatar_url" :alt="`${reply.author || '会员'}的头像`" referrerpolicy="no-referrer" @error="$event.currentTarget.remove()" />
            </div>
            <b>{{ reply.author || '匿名会员' }}</b>
            <div class="profile-contact" title="历史存档，只读">＋ 加好友 ✉ 发短信</div>
            <div class="rank-strip" :title="reply.historical_profile?.rank ? `历史快照：${reply.historical_profile.snapshot}` : '原军衔未收录，显示现存会员等级'">
              <span>{{ reply.historical_profile?.rank || reply.user_group || '论坛会员' }}</span><i aria-hidden="true">❯❯</i>
            </div>
            <dl class="profile-facts">
              <dt>等级：</dt><dd>{{ reply.historical_profile?.rank || reply.user_group || '未收录' }}</dd>
              <dt>帖子：</dt><dd class="profile-count">{{ reply.historical_profile?.posts || '未收录' }}</dd>
              <dt>积分：</dt><dd>{{ reply.historical_profile?.points || '未收录' }}</dd>
              <dt>G 币：</dt><dd>{{ reply.historical_profile?.coins || '未收录' }}</dd>
              <dt>精华：</dt><dd>{{ reply.historical_profile?.essence || '未收录' }}</dd>
              <dt>注册：</dt><dd class="registered-at">{{ reply.historical_profile?.registered || '未收录' }}</dd>
            </dl>
          </aside>
          <div class="floor-body">
            <div class="floor-meta"><span>{{ reply.user_group || '论坛会员' }}</span><strong>存档 {{ (selected.floor_offset || 0) + index + 1 }}楼</strong></div>
            <div class="post-by">Post By：{{ formatDate(reply.created_at) }}</div>
            <div class="message">
              <div v-if="reply.message_html" class="message-html" v-html="reply.message_html"></div>
              <div v-else class="message-text">{{ reply.message || (reply.attachments?.length ? '' : '（内容为空）') }}</div>
              <div v-if="!reply.message_html && reply.attachments?.length" class="attachments">
                <a v-for="(attachment, attachmentIndex) in reply.attachments" :key="`${attachment.url}-${attachmentIndex}`" :href="attachment.url" target="_blank" rel="noreferrer">
                  <span class="attachment-icon">{{ attachment.kind.slice(0, 3) }}</span>
                  <span><b>下载附件</b><small>{{ attachment.name }}　({{ attachment.kind }} 文件)</small></span>
                </a>
              </div>
              <details v-if="ratingsByFloor[index + 1]?.length" class="ratings-panel" open>
                <summary>本楼评分记录（{{ ratingsByFloor[index + 1].length }} 条）</summary>
                <table><thead><tr><th>评分人</th><th>评分</th><th>理由</th><th>时间</th></tr></thead><tbody>
                  <tr v-for="(rating,ratingIndex) in ratingsByFloor[index + 1]" :key="ratingIndex"><td>{{ rating.posterName || '未收录' }}</td><td>{{ Number(rating.score) > 0 ? '+' : '' }}{{ rating.score ?? '未收录' }} {{ rating.beanUnit }}</td><td>{{ rating.reason || '未收录' }}</td><td>{{ rating.createTime ? new Date(rating.createTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '未收录' }}</td></tr>
                </tbody></table>
              </details>
              <div v-if="reply.signature_html || reply.signature" class="signature"><hr /><div v-if="reply.signature_html" v-html="reply.signature_html"></div><div v-else>{{ reply.signature }}</div></div>
            </div>
            <div class="floor-tail"><span>支持(0)</span><span>反对(0)</span><span>引用</span><span>回复</span><span>TOP</span></div>
          </div>
        </section>
        <section v-if="!selected.replies_list?.length" class="post-floor single"><div class="floor-body"><div class="message">{{ selected.body || '暂未解析到正文，可打开原始存档查看。' }}</div></div></section>
        <div class="original-link">历史帖子只读存档</div>
        <div v-if="selected.thread_pages?.length > 1" class="list-pagination" role="navigation" aria-label="主题存档分页"><button :disabled="selected.thread_page <= 1" @click="openPost(selected, selected.thread_page - 1)">上一页</button><span>第 {{ selected.thread_pages[selected.thread_page - 1] }} 页</span><button :disabled="selected.thread_page >= selected.thread_pages.length" @click="openPost(selected, selected.thread_page + 1)">下一页</button></div>
      </template>
    </article>
  </main>
  <footer>
    <section class="footer-thanks" aria-label="特别鸣谢">
      <strong>特别鸣谢</strong>
      <p>感谢 QQ 群「步步高电子词典游戏群」（群号：830340878），特别感谢群主「无云」导出并提供论坛帖子快照，让这些旧日交流得以保存与重现。</p>
    </section>
    <div>步步高官方论坛时光机 · 本地归档浏览器 · 页面内容版权归原作者所有</div>
  </footer>
</template>
