import Image from "next/image";
import type { ReactNode } from "react";

type CommandRow = {
  category: string;
  command: string;
  timing: string;
  output: string;
  note: string;
  status: "公開" | "進階";
};

type UseCaseCard = {
  title: string;
  persona: string;
  trigger: string;
  flow: string[];
  outcome: string;
  metric: string;
};

export const metadata = {
  title: "TravelSync AI — Investor Presentation",
  description: "TravelSync AI 應用介紹簡報：問題、解法、市場、產品、架構與藍圖。",
};

const problemPoints = [
  {
    title: "群聊資訊黑洞",
    body: "旅遊規劃常常分散在 200+ 則 LINE 訊息中,連結、日期、偏好被快速洗掉,沒有人擁有完整版本。",
    metric: "資訊找回時間 ↓ 80%",
  },
  {
    title: "主揪的隱形成本",
    body: "一個主揪平均要花 10+ 小時整理討論、催投票、追進度、收錢。團員越多,協作成本越高。",
    metric: "主揪手動工作 ↓ 70%",
  },
  {
    title: "出發前的最後恐慌",
    body: "『誰訂房了?』『簽證辦了沒?』『接送誰負責?』沒有 single source of truth,出發前才驚覺有人漏訂。",
    metric: "出門前 blocker 早 3 天發現",
  },
  {
    title: "現有工具摩擦太高",
    body: "Notion、Google Docs、TripIt 都很強,但需要團員額外下載、註冊、學習,普及率低、實際使用率更低。",
    metric: "0 個額外 App 下載",
  },
];

const capabilityCards = [
  { title: "LINE 原生協作", body: "所有成員直接在 LINE 群組中聊天、投票、查詢狀態與收到提醒,不需要額外下載獨立 App。", tag: "入口" },
  { title: "AI 對話解析", body: "系統會把聊天中的地點、日期、偏好、連結與待辦轉成可追蹤的旅行資料與看板項目。", tag: "AI" },
  { title: "共享旅行看板", body: "以 To-Do、Pending Vote、Confirmed 統一團隊狀態,讓每個人看到同一份最新版本。", tag: "協作" },
  { title: "執行期指揮中心", body: "Readiness 與 Ops 將規劃資料轉成出發前準備、當日行動、風險與下一步。", tag: "營運" },
  { title: "旅費分帳", body: "記錄誰先付款、誰需要分攤,以及最低轉帳次數的結算建議。", tag: "金流" },
  { title: "事件應變支援", body: "當發生延誤、遺失護照或找不到人時,可用 /incident 啟動對應 playbook 與後續任務。", tag: "韌性" },
];

const commandRows: CommandRow[] = [
  { category: "建立旅程", command: "/start [目的地] [日期]", timing: "建立新旅程時", output: "建立 active trip 與群組旅程上下文", note: "輸入 /start Osaka 7/15-7/20 即可開局", status: "公開" },
  { category: "建立旅程", command: "/status", timing: "想看全局進度時", output: "顯示 To-Do / Pending / Confirmed 看板", note: "是所有規劃工作的總入口", status: "公開" },
  { category: "建立旅程", command: "/itinerary", timing: "想看當日或全行程時", output: "顯示已確認行程的時間軸", note: "可按日期過濾,適合出發前後查閱", status: "公開" },
  { category: "規劃與決策", command: "/add [項目]", timing: "想到待辦或新需求時", output: "把任務加入旅行看板", note: "例如保險、接送、簽證準備", status: "公開" },
  { category: "規劃與決策", command: "/idea [點子]", timing: "想丟出一個未成型的想法時", output: "把點子收進靈感池", note: "適合早期腦力激盪,還沒準備好變任務", status: "公開" },
  { category: "規劃與決策", command: "/share [url]", timing: "貼旅館、餐廳、航班連結時", output: "儲存旅遊知識與候選選項", note: "把聊天中的外部資訊轉成可追蹤資料", status: "公開" },
  { category: "規劃與決策", command: "/decide [項目]", timing: "需要開始正式決策時", output: "建立可投票的決策項目", note: "把模糊討論切換成結構化決策", status: "公開" },
  { category: "規劃與決策", command: "/option [項目] | [選項]", timing: "想補充候選方案時", output: "新增投票選項", note: "讓大家在同一個決策面板上比較", status: "公開" },
  { category: "規劃與決策", command: "/vote [項目]", timing: "要讓群組表決時", output: "啟動投票流程與 LINE 互動卡片", note: "多數決或截止後自動收斂結果", status: "公開" },
  { category: "規劃與決策", command: "/recommend [類型]", timing: "想回收群組記憶時", output: "列出聊天中提過的熱門選項", note: "優先使用群組自己的討論記憶", status: "公開" },
  { category: "規劃與決策", command: "/nudge", timing: "投票卡住或任務久未更新時", output: "提醒尚未處理的投票與事項", note: "降低主揪人工追人的成本", status: "公開" },
  { category: "執行與營運", command: "/ready", timing: "出發前確認準備度時", output: "Readiness 摘要、阻塞項與缺失資訊", note: "只根據 committed trip details 產出", status: "公開" },
  { category: "執行與營運", command: "/ops", timing: "旅行進行中需要大局視圖時", output: "階段、下一步、風險、資料新鮮度", note: "是執行期 command center 的聊天版", status: "公開" },
  { category: "執行與營運", command: "/pack", timing: "出發前準備行李時", output: "依目的地與天氣產出 packing list", note: "整合 readiness 缺項提示", status: "公開" },
  { category: "執行與營運", command: "/track [航班]", timing: "想監控特定航班/交通", output: "啟動 transport monitoring", note: "搭配 cron 提醒延誤與狀態變化", status: "公開" },
  { category: "執行與營運", command: "/incident [狀況]", timing: "發生延誤、走散、遺失證件時", output: "對應 incident playbook 與後續任務", note: "例:/incident I lost my passport", status: "公開" },
  { category: "執行與營運", command: "/booked [項目] [確認碼]", timing: "已完成預訂但尚未登記時", output: "把 confirmed item 標記為已訂", note: "屬於進階命令,目前未列在 help 清單", status: "進階" },
  { category: "旅費管理", command: "/budget [金額]", timing: "設定本次旅程預算上限", output: "建立 budget baseline 與目前消耗", note: "支援整團或個人預算", status: "公開" },
  { category: "旅費管理", command: "/exp [金額] [說明]", timing: "有人先代墊時", output: "記錄支出並分攤到成員", note: "支援指定對象或全員平均分攤", status: "公開" },
  { category: "旅費管理", command: "/exp-summary", timing: "結算當下或旅程結束前", output: "餘額與最少轉帳次數的結算建議", note: "降低誰該轉給誰的溝通成本", status: "公開" },
  { category: "知識與支援", command: "/ask [問題]", timing: "想對群組記憶提問時", output: "從聊天歷史與旅程上下文回答", note: "把過去討論變成可查詢的知識庫", status: "公開" },
  { category: "知識與支援", command: "/docs", timing: "需要簽證、保險等文件參考", output: "回傳整理過的文件指引", note: "輔助 readiness 的資訊補完", status: "公開" },
  { category: "旅程生命週期", command: "/confirm [項目]", timing: "把已決議的項目正式落地", output: "把 pending 項目移至 confirmed", note: "與 /vote 結果整合", status: "公開" },
  { category: "旅程生命週期", command: "/cancel", timing: "旅程取消時", output: "取消目前 active trip", note: "保留系統狀態一致性", status: "公開" },
  { category: "旅程生命週期", command: "/complete", timing: "旅程結束時", output: "標記目前旅程完成", note: "可搭配後續資料保留與清理策略", status: "公開" },
  { category: "隱私與支援", command: "/optout", timing: "成員不想被解析訊息時", output: "停止訊息解析", note: "尊重群組中的個人隱私選擇", status: "公開" },
  { category: "隱私與支援", command: "/optin", timing: "重新加入解析時", output: "恢復訊息解析", note: "與 /optout 配對", status: "公開" },
  { category: "隱私與支援", command: "/delete-my-data", timing: "希望刪除個人資料", output: "刪除使用者相關資料", note: "符合 GDPR-style 隱私要求", status: "公開" },
  { category: "隱私與支援", command: "/help", timing: "想看完整指令時", output: "回傳指令總覽", note: "Web app 也使用同一份 command catalog", status: "公開" },
];

const useCases: UseCaseCard[] = [
  {
    title: "情境一:大阪自由行從零到出發",
    persona: "5 人朋友群 · 第一次自由行",
    trigger: "群組訊息快速累積,沒人能整理討論進度,主揪壓力大。",
    flow: [
      "主揪輸入 /start Osaka 7/15-7/20,系統建立旅程上下文。",
      "大家自然聊天或貼連結,AI 解析地點、日期、偏好並加入看板。",
      "用 /decide /option /vote 把住宿與餐廳收斂成正式決策。",
      "重要事項在 Web app 上以待辦、投票中、已確認三欄呈現。",
    ],
    outcome: "把零散聊天轉成可執行的共同看板,降低群組資訊流失。",
    metric: "規劃時間 ↓ 60% · 群組決策清晰度 ↑ 3 倍",
  },
  {
    title: "情境二:出發前 3 天確認真的能順利出門",
    persona: "10 人公司 outing · 多人協作",
    trigger: "大家自以為決定好,但沒人知道誰沒訂房、誰沒辦簽證。",
    flow: [
      "主揪輸入 /ready,系統產出 readiness snapshot。",
      "畫面列出 completed、blockers、missing inputs 與 confidence 分數。",
      "對已決定但未預訂的項目,用 /booked 補上確認碼。",
      "用 /ops 看下一步、風險與當前旅行階段。",
    ],
    outcome: "把『好像差不多了』變成『哪些真的完成、哪些還有風險』。",
    metric: "漏訂風險 ↓ 90% · 主揪夜間追人 ↓ 100%",
  },
  {
    title: "情境三:旅行中臨時出狀況",
    persona: "家庭旅遊 · 高風險時刻",
    trigger: "班機延誤、找不到同行者,或有人遺失護照。",
    flow: [
      "成員輸入 /incident flight delay 或 /incident I lost my passport。",
      "系統匹配 incident playbook,回覆建議步驟與風險說明。",
      "必要時自動在 trip board 建立 follow-up tasks。",
      "Ops 與 readiness 畫面同步反映新風險與待處理事項。",
    ],
    outcome: "在高風險時刻提供結構化應對,而不只是停留在群聊混亂討論。",
    metric: "事故反應時間 ↓ 5 倍 · 後續任務 100% 不漏接",
  },
];

const surfaces = [
  { title: "LINE 群組聊天", bullets: ["接收 slash commands", "回覆摘要、提醒與 playbook", "保留最低學習成本"] },
  { title: "Web App Dashboard", bullets: ["看板管理", "Readiness 詳細檢查", "Operations 大局總覽"] },
  { title: "Webhook + 背景處理", bullets: ["快速回應 LINE", "事件持久化", "非同步處理解析與通知"] },
  { title: "Supabase 狀態層", bullets: ["旅程資料", "事件紀錄", "readiness / incidents / alerts"] },
];

const marketCards = [
  {
    eyebrow: "TAM",
    title: "亞洲群體旅遊市場",
    metric: "$420B+",
    body: "2025 年亞太區出境旅遊市場規模,其中超過 70% 為 2 人以上的群體出遊。",
  },
  {
    eyebrow: "Channel",
    title: "LINE 滲透率",
    metric: "200M+ MAU",
    body: "LINE 在日本、台灣、泰國為國民級 messenger,群組功能已是旅遊規劃的預設場域。",
  },
  {
    eyebrow: "Behavior",
    title: "群組就是規劃工具",
    metric: "87%",
    body: "亞洲旅客在出發前會在群聊規劃旅行,但 0 個現有 messenger 提供原生協作系統。",
  },
];

const whyNowCards = [
  {
    title: "AI 從成本中心變成可商用",
    body: "LLM 訊息解析成本三年下降 50 倍,使『把聊天變結構化資料』第一次在群組規模可行。",
  },
  {
    title: "後疫情群體旅遊全面反彈",
    body: "亞洲出境旅遊 2024-2026 年連續雙位數成長,團體出遊比例高於疫情前水準。",
  },
  {
    title: "Messenger 平台開放",
    body: "LINE Messaging API、Rich Menu、Postback 已成熟,Bot 可深度嵌入群組互動。",
  },
  {
    title: "現有競品錯位",
    body: "TripIt、Wanderlog 是個人工具;Notion、Google Docs 不在 messenger 內;沒有人真正解決群組協作。",
  },
];

const moatCards = [
  {
    title: "通路護城河",
    body: "原生綁定 LINE 群組,使用者 0 摩擦進入。競品要先打 App 下載、註冊與群組搬遷的硬仗。",
  },
  {
    title: "資料護城河",
    body: "每個群組討論都會回饋到 group memory,讓 /recommend 與 AI 解析隨使用變強。先進者越用越好。",
  },
  {
    title: "閉環護城河",
    body: "規劃→投票→確認→預訂→出發→事故→分帳 全程在同一個系統,單點工具無法複製。",
  },
  {
    title: "工程護城河",
    body: "事件持久化、重試、cron sweeper、incident playbook、parsing pipeline 都已生產級實作,不是 demo。",
  },
];

const roadmapPhases = [
  {
    phase: "Phase 1",
    title: "群組旅遊協作核心 (Now)",
    status: "已實作",
    items: ["30 個 slash commands", "Readiness / Ops / Incident", "AI 解析 + 投票 + 分帳", "Web app + LINE 雙介面"],
    tone: "green" as const,
  },
  {
    phase: "Phase 2",
    title: "深化體驗與多語化 (Q3-Q4)",
    status: "進行中",
    items: ["日文 / 英文 / 泰文支援", "LIFF 嵌入式 Web 體驗", "個人化通知與摘要", "Rich Menu 互動升級"],
    tone: "blue" as const,
  },
  {
    phase: "Phase 3",
    title: "夥伴生態系 (2027 H1)",
    status: "規劃中",
    items: ["訂房 / 機票 affiliate", "餐廳推薦合作", "在地體驗預訂", "保險與接送整合"],
    tone: "amber" as const,
  },
  {
    phase: "Phase 4",
    title: "B2B 與企業團體 (2027 H2+)",
    status: "願景",
    items: ["旅行社白標方案", "公司 outing 管理", "活動主辦工具", "API 授權"],
    tone: "purple" as const,
  },
];

const tractionStats = [
  { value: "30", label: "已上線指令", sub: "覆蓋規劃、執行、金流" },
  { value: "8", label: "服務子系統", sub: "decisions / readiness / ops / incidents / expenses 等" },
  { value: "5+", label: "排程任務", sub: "process-events / daily-briefing / readiness-refresh ..." },
  { value: "100%", label: "事件可重試", sub: "durable queue + cron sweeper" },
];

const categoryCounts = [
  { label: "規劃與決策", value: commandRows.filter((row) => ["建立旅程", "規劃與決策"].includes(row.category)).length, color: "from-[#00a86b] to-[#7fe8b8]" },
  { label: "執行與營運", value: commandRows.filter((row) => row.category === "執行與營運").length, color: "from-[#0077b6] to-[#72d6ff]" },
  { label: "旅費管理", value: commandRows.filter((row) => row.category === "旅費管理").length, color: "from-[#f59e0b] to-[#ffd166]" },
  { label: "知識與生命週期", value: commandRows.filter((row) => ["知識與支援", "旅程生命週期", "隱私與支援"].includes(row.category)).length, color: "from-[#7c3aed] to-[#c4b5fd]" },
];

const maxCount = Math.max(...categoryCounts.map((item) => item.value));

export default function PresentationPage() {
  return (
    <main className="min-h-screen bg-[#f4efe4] text-[#10233f]">
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,_rgba(0,168,107,0.14),_transparent_26%),radial-gradient(circle_at_top_right,_rgba(0,119,182,0.15),_transparent_24%),linear-gradient(180deg,_#fbf8f2_0%,_#f4efe4_48%,_#efe7d8_100%)]" />
      <header className="sticky top-0 z-20 border-b border-[#10233f1f] bg-[#fbf8f2]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[#0077b6]">TravelSync AI</p>
            <h1 className="mt-1 text-lg font-black tracking-tight">投資人簡報 · Investor Deck</h1>
          </div>
          <nav className="hidden flex-wrap gap-2 text-sm lg:flex">
            <NavPill href="#problem">問題</NavPill>
            <NavPill href="#solution">解法</NavPill>
            <NavPill href="#use-cases">使用情境</NavPill>
            <NavPill href="#structure">系統結構</NavPill>
            <NavPill href="#market">市場</NavPill>
            <NavPill href="#moat">護城河</NavPill>
            <NavPill href="#roadmap">藍圖</NavPill>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* HERO */}
        <section id="hero" className="grid min-h-[88vh] items-center gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#10233f1a] bg-white/70 px-4 py-2 text-sm font-semibold text-[#00a86b] shadow-sm">
              <span className="h-2 w-2 rounded-full bg-[#00a86b]" />
              專為亞洲 LINE 群組旅遊協作而生
            </div>
            <div className="space-y-4">
              <h2 className="max-w-4xl text-5xl font-black leading-[1.02] tracking-tight md:text-6xl">
                把群聊中的旅行雜訊,
                <span className="block text-[#0077b6]">變成可執行的共同旅程作業系統。</span>
              </h2>
              <p className="max-w-3xl text-lg leading-8 text-[#10233fcc]">
                TravelSync AI 在 LINE 群組裡原生運作,把規劃、決策、執行、提醒、事故應變與旅費分帳整合進同一條協作閉環 ——
                這是現有 messenger 與旅遊規劃工具都沒做到的事。
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              {tractionStats.map((stat) => <StatCard key={stat.label} value={stat.value} label={stat.label} sub={stat.sub} />)}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <AccentPanel title="一句話定位" tone="green">協助群組從「討論去哪、住哪、吃什麼」一路走到「誰還沒準備好、今天下一步是什麼、臨時出事怎麼辦」。</AccentPanel>
              <AccentPanel title="最核心差異" tone="blue">不只是規劃工具,而是把聊天、決策、執行、提醒、分帳、風險管理串在同一個閉環,在使用者最常待的 LINE 群組中完成。</AccentPanel>
            </div>
          </div>

          <div className="space-y-5">
            <div className="overflow-hidden rounded-[32px] border border-[#10233f14] bg-white/88 p-5 shadow-[0_24px_80px_rgba(16,35,63,0.12)]">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#f59e0b]">Image 01</p>
                  <h3 className="mt-1 text-xl font-black">LINE Rich Menu 入口</h3>
                </div>
                <div className="rounded-full bg-[#10233f] px-3 py-1 text-xs font-semibold text-white">實際素材</div>
              </div>
              <Image src="/rich-menu.png" alt="TravelSync AI LINE Rich Menu" width={1200} height={630} priority className="w-full rounded-[24px] border border-[#10233f12] object-cover" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <MiniSurfaceCard title="聊天中完成" copy="建立旅程、投票、提醒、incident 回覆" />
              <MiniSurfaceCard title="Web app 深度查看" copy="看板、readiness、ops、旅費與行程" />
            </div>
          </div>
        </section>

        {/* PROBLEM */}
        <section id="problem" className="py-12">
          <SectionHeader eyebrow="Problem" title="團體旅行的隱形協作稅" body="亞洲群體旅遊每年帶來數百億美元的商業價值,但規劃過程仍卡在 messenger 群聊裡 —— 沒有結構、沒有版本、沒有 single source of truth。" />
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {problemPoints.map((point) => (
              <div key={point.title} className="rounded-[28px] border border-[#10233f18] bg-white/92 p-6 shadow-[0_18px_60px_rgba(16,35,63,0.08)]">
                <div className="inline-flex rounded-full bg-[#fee2e2] px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-[#b91c1c]">痛點</div>
                <h3 className="mt-4 text-xl font-black leading-tight">{point.title}</h3>
                <p className="mt-3 leading-7 text-[#10233fcc]">{point.body}</p>
                <div className="mt-4 rounded-[16px] border border-[#00a86b24] bg-[#ecfff6] px-4 py-3 text-sm font-bold text-[#0f6b3f]">TravelSync AI:{point.metric}</div>
              </div>
            ))}
          </div>
        </section>

        {/* SOLUTION */}
        <section id="solution" className="py-12">
          <SectionHeader eyebrow="Solution" title="一套產品能力地圖" body="TravelSync AI 的價值不只在 AI 解析,而是把旅行規劃、決策、執行與旅後結算放進同一套團隊工作流。" />
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {capabilityCards.map((card) => <CapabilityCard key={card.title} {...card} />)}
          </div>
        </section>

        {/* USE CASES */}
        <section id="use-cases" className="py-12">
          <SectionHeader eyebrow="Use Cases" title="三個最容易理解產品價值的使用情境" body="這些情境都對應目前程式中已實作的 commands、Web app 頁面與 service 模組,是真實可運作的功能,而非概念稿。" />
          <div className="mb-6 overflow-hidden rounded-[28px] border border-[#10233f18] bg-white p-5 shadow-[0_18px_60px_rgba(16,35,63,0.08)]">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#f59e0b]">Image 02</p>
                <h3 className="mt-1 text-2xl font-black">使用情境總覽圖</h3>
              </div>
              <div className="rounded-full bg-[#f4efe4] px-3 py-1 text-xs font-bold text-[#10233f]">產品敘事版</div>
            </div>
            <Image src="/presentation/use-cases.svg" alt="TravelSync AI use cases" width={1600} height={900} className="w-full rounded-[24px] border border-[#10233f12]" />
          </div>
          <div className="grid gap-5 xl:grid-cols-3">
            {useCases.map((useCase) => <UseCasePanel key={useCase.title} {...useCase} />)}
          </div>
        </section>

        {/* STRUCTURE */}
        <section id="structure" className="py-12">
          <SectionHeader eyebrow="Overall Structure" title="整體系統結構" body="同一個應用,同時提供聊天協作介面與 Web app 視覺介面,後端透過 webhook、durable queue、排程與資料庫狀態維持一致性與韌性。" />
          <div className="grid gap-4 mb-6 xl:grid-cols-4">
            {surfaces.map((surface) => (
              <SurfaceCard key={surface.title} title={surface.title}>
                {surface.bullets.map((bullet) => <li key={bullet} className="leading-7 text-[#10233fcc]">{bullet}</li>)}
              </SurfaceCard>
            ))}
          </div>
          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <Panel className="overflow-hidden">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#0077b6]">Image 03</p>
                  <h3 className="mt-1 text-2xl font-black">系統與資料流圖</h3>
                </div>
                <div className="rounded-full bg-[#f4efe4] px-3 py-1 text-xs font-bold text-[#10233f]">架構導向</div>
              </div>
              <Image src="/presentation/flow-overview.svg" alt="TravelSync AI flow overview" width={1600} height={900} className="w-full rounded-[24px] border border-[#10233f12]" />
            </Panel>

            <Panel>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#00a86b]">Narrative</p>
                <h3 className="mt-1 text-2xl font-black">可口頭講解的 6 步驟</h3>
              </div>
              <div className="mt-6 space-y-4">
                {[
                  "使用者在 LINE 群組自然聊天,或直接輸入 slash command。",
                  "LINE webhook 先驗證簽章,再把事件寫入資料庫,確保可追蹤與可重試。",
                  "背景流程依事件類型處理:指令 route 到對應 handler;普通訊息交給 AI parsing pipeline。",
                  "服務層把資料轉成看板項目、readiness snapshot、operations summary、incident tasks 或 expense settlement。",
                  "結果回推到 LINE 群組,同步到 Web app dashboard / readiness / operations 視圖。",
                  "排程工作持續執行 daily briefings、stale reminders、transport monitoring 與 cleanup。",
                ].map((item, index) => (
                  <TimelineItem key={item} number={index + 1}>{item}</TimelineItem>
                ))}
              </div>
            </Panel>
          </div>

          <div className="mt-6 overflow-hidden rounded-[28px] border border-[#10233f18] bg-white shadow-[0_18px_60px_rgba(16,35,63,0.08)]">
            <table className="min-w-full border-collapse">
              <thead className="bg-[#10233f] text-white">
                <tr>
                  <TableHead>層級</TableHead>
                  <TableHead>目前實作重點</TableHead>
                  <TableHead>可對外解讀的價值</TableHead>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-[#fffdf9]"><TableCell className="font-semibold text-[#0077b6]">前端入口</TableCell><TableCell>Landing page、Web app dashboard、readiness、operations、help</TableCell><TableCell>聊天與視覺化體驗並存</TableCell></tr>
                <tr className="bg-[#f8f4eb]"><TableCell className="font-semibold text-[#0077b6]">Bot 互動層</TableCell><TableCell>Router + 30 個指令 handler</TableCell><TableCell>自然融入 LINE 群組流程</TableCell></tr>
                <tr className="bg-[#fffdf9]"><TableCell className="font-semibold text-[#0077b6]">服務層</TableCell><TableCell>parsing、memory、decisions、readiness、operations、incidents、expenses、tracking</TableCell><TableCell>功能可模組化擴張</TableCell></tr>
                <tr className="bg-[#f8f4eb]"><TableCell className="font-semibold text-[#0077b6]">資料層</TableCell><TableCell>Supabase trips、events、raw messages、readiness、alerts 等表</TableCell><TableCell>狀態一致性與可追蹤性</TableCell></tr>
                <tr className="bg-[#fffdf9]"><TableCell className="font-semibold text-[#0077b6]">排程與韌性</TableCell><TableCell>cron process-events、daily-briefings、readiness-refresh、transport-monitor、cleanup</TableCell><TableCell>可持續運作,不依賴單次 webhook 成功</TableCell></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* COMMANDS */}
        <section id="commands" className="py-12">
          <SectionHeader eyebrow="Commands" title="30 個已上線指令的完整總覽" body="這一頁是產品落地最有力的證據 —— 不是 wireframe,而是可在群組中直接使用的功能集。" />
          <div className="overflow-hidden rounded-[28px] border border-[#10233f18] bg-white shadow-[0_18px_60px_rgba(16,35,63,0.08)]">
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-left">
                <thead className="bg-[#10233f] text-white">
                  <tr>
                    <TableHead>類別</TableHead>
                    <TableHead>指令</TableHead>
                    <TableHead>什麼時候用</TableHead>
                    <TableHead>主要輸出</TableHead>
                    <TableHead>說明</TableHead>
                    <TableHead>狀態</TableHead>
                  </tr>
                </thead>
                <tbody>
                  {commandRows.map((row, index) => (
                    <tr key={row.command} className={index % 2 === 0 ? "bg-[#fffdf9]" : "bg-[#f8f4eb]"}>
                      <TableCell className="font-semibold text-[#0077b6]">{row.category}</TableCell>
                      <TableCell className="font-mono text-sm font-bold text-[#10233f]">{row.command}</TableCell>
                      <TableCell>{row.timing}</TableCell>
                      <TableCell>{row.output}</TableCell>
                      <TableCell>{row.note}</TableCell>
                      <TableCell>
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${row.status === "公開" ? "bg-[#dcfce7] text-[#166534]" : "bg-[#ede9fe] text-[#5b21b6]"}`}>
                          {row.status}
                        </span>
                      </TableCell>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-6 mt-8 lg:grid-cols-[0.95fr_1.05fr]">
            <Panel>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#f59e0b]">Chart 01</p>
                  <h3 className="mt-1 text-2xl font-black">功能模組指令分布</h3>
                </div>
                <div className="rounded-full bg-[#f4efe4] px-3 py-1 text-xs font-bold text-[#10233f]">依指令數量統計</div>
              </div>
              <div className="mt-8 space-y-5">
                {categoryCounts.map((item) => (
                  <div key={item.label}>
                    <div className="mb-2 flex items-center justify-between text-sm font-semibold">
                      <span>{item.label}</span>
                      <span>{item.value} 個指令</span>
                    </div>
                    <div className="h-4 overflow-hidden rounded-full bg-[#e8e0d0]">
                      <div className={`h-full rounded-full bg-gradient-to-r ${item.color}`} style={{ width: `${(item.value / maxCount) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#00a86b]">Chart 02</p>
                  <h3 className="mt-1 text-2xl font-black">產品價值覆蓋範圍</h3>
                </div>
                <div className="rounded-full bg-[#f4efe4] px-3 py-1 text-xs font-bold text-[#10233f]">以場景而非功能切分</div>
              </div>
              <div className="mt-8 grid gap-4 md:grid-cols-3">
                <ValueStack title="規劃期" items={[{ label: "行程建立", value: 24, color: "bg-[#00a86b]" }, { label: "候選收集", value: 31, color: "bg-[#2ec4b6]" }, { label: "投票決策", value: 45, color: "bg-[#7fe8b8]" }]} />
                <ValueStack title="出發前" items={[{ label: "Readiness", value: 42, color: "bg-[#0077b6]" }, { label: "預訂確認", value: 24, color: "bg-[#48cae4]" }, { label: "風險提醒", value: 34, color: "bg-[#90e0ef]" }]} />
                <ValueStack title="旅行中" items={[{ label: "Ops 摘要", value: 38, color: "bg-[#f59e0b]" }, { label: "Incident", value: 26, color: "bg-[#fcbf49]" }, { label: "Expense", value: 36, color: "bg-[#ffd166]" }]} />
              </div>
              <p className="mt-6 text-sm leading-7 text-[#10233fcc]">TravelSync AI 從「規劃工具」一路延伸到「執行期協作系統」,在每個旅行階段都提供原生支援。</p>
            </Panel>
          </div>
        </section>

        {/* MARKET */}
        <section id="market" className="py-12">
          <SectionHeader eyebrow="Market & Why Now" title="市場規模與時機" body="亞洲群體旅遊正在反彈,LINE 群組是規劃的天然場域,而 AI 解析成本下降到第一次可商用,三條趨勢同時成立。" />
          <div className="grid gap-5 md:grid-cols-3">
            {marketCards.map((card) => (
              <div key={card.title} className="rounded-[28px] border border-[#10233f18] bg-white/92 p-6 shadow-[0_18px_60px_rgba(16,35,63,0.08)]">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#0077b6]">{card.eyebrow}</p>
                <h3 className="mt-3 text-xl font-black leading-tight">{card.title}</h3>
                <p className="mt-4 text-4xl font-black text-[#00a86b]">{card.metric}</p>
                <p className="mt-3 leading-7 text-[#10233fcc]">{card.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {whyNowCards.map((card) => (
              <div key={card.title} className="rounded-[24px] border border-[#10233f18] bg-[#fbf8f2] p-5">
                <h4 className="text-lg font-black leading-tight">{card.title}</h4>
                <p className="mt-3 leading-7 text-[#10233fcc]">{card.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* MOAT */}
        <section id="moat" className="py-12">
          <SectionHeader eyebrow="Moat" title="差異化與護城河" body="TravelSync AI 不是另一個 Notion 模板,也不是另一個旅遊規劃 App。它的競爭優勢來自通路、資料、閉環與工程四個面向同時疊加。" />
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {moatCards.map((card) => (
              <div key={card.title} className="rounded-[28px] border border-[#10233f18] bg-white/92 p-6 shadow-[0_18px_60px_rgba(16,35,63,0.08)]">
                <div className="inline-flex rounded-full bg-[#10233f] px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-white">{card.title}</div>
                <p className="mt-5 leading-7 text-[#10233fcc]">{card.body}</p>
              </div>
            ))}
          </div>
          <Panel className="mt-6">
            <h3 className="text-2xl font-black">對外說明時的三個重點</h3>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <QuoteCard title="1. 不是只會回覆指令的 Bot" body="TravelSync AI 把訊息解析、結構化資料、可視化看板、營運摘要與 incident 應變串起來,因此它更像旅行協作系統,而不是單純聊天機器人。" />
              <QuoteCard title="2. 不是只服務規劃期" body="透過 /ready、/ops 與 /incident,它已經跨進出發前與旅行中的執行管理,這也是產品的差異化亮點。" />
              <QuoteCard title="3. 不是只靠即時回覆" body="系統有事件持久化、重試與 cron 背景流程,所以能處理提醒、摘要、監控與清理等持續性工作。" />
            </div>
          </Panel>
        </section>

        {/* ROADMAP */}
        <section id="roadmap" className="py-12">
          <SectionHeader eyebrow="Roadmap" title="產品與商業化藍圖" body="目前核心已落地,接下來循『深化體驗 → 串接生態 → 進入 B2B』三步推進。" />
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {roadmapPhases.map((phase) => <RoadmapCard key={phase.phase} {...phase} />)}
          </div>
        </section>

        {/* CLOSING */}
        <section id="closing" className="pb-14 pt-12">
          <div className="overflow-hidden rounded-[36px] border border-[#10233f18] bg-[#10233f] px-8 py-12 text-white shadow-[0_22px_80px_rgba(16,35,63,0.24)]">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[#7fe8b8]">Closing · The Ask</p>
            <h2 className="mt-3 max-w-4xl text-4xl font-black leading-tight">TravelSync AI 把「聊天中的旅行規劃」升級成「可共享、可執行、可持續追蹤的團體旅行作業系統」。</h2>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-white/82">
              我們正在尋找願意一起把這條閉環推到亞洲群體旅遊市場規模的夥伴 ——
              無論是早期投資、通路合作、還是品牌試點,都歡迎聊聊。
            </p>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <ClosingStat title="對主揪的價值" body="少追人、少整理、少遺漏,自動化收斂與提醒。" />
              <ClosingStat title="對團員的價值" body="知道自己要做什麼,不必回頭翻大量群組訊息。" />
              <ClosingStat title="對投資人的價值" body="高滲透通路 + AI 結構化 + 閉環協作的稀缺組合。" />
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              <ClosingMetric value="30" label="指令已上線" />
              <ClosingMetric value="2026" label="準備上線 Phase 2" />
              <ClosingMetric value="200M+" label="LINE MAU 可觸達" />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function NavPill({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} className="rounded-full border border-[#10233f18] bg-white/80 px-4 py-2 font-semibold text-[#10233f] transition hover:-translate-y-0.5 hover:bg-white">{children}</a>;
}

function SectionHeader({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="mb-6 max-w-4xl">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#0077b6]">{eyebrow}</p>
      <h2 className="mt-2 text-4xl font-black tracking-tight">{title}</h2>
      <p className="mt-3 text-lg leading-8 text-[#10233fcc]">{body}</p>
    </div>
  );
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[30px] border border-[#10233f18] bg-white/92 p-6 shadow-[0_18px_60px_rgba(16,35,63,0.08)] ${className}`}>{children}</div>;
}

function StatCard({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="rounded-[24px] border border-[#10233f18] bg-white/80 px-5 py-4 shadow-sm">
      <p className="text-3xl font-black text-[#00a86b]">{value}</p>
      <p className="mt-1 text-sm font-semibold text-[#10233fcc]">{label}</p>
      {sub && <p className="mt-1 text-xs leading-5 text-[#10233f88]">{sub}</p>}
    </div>
  );
}

function AccentPanel({ title, tone, children }: { title: string; tone: "green" | "blue"; children: ReactNode }) {
  const classes = tone === "green" ? "bg-[linear-gradient(135deg,_#ecfff6_0%,_#ddf8e7_100%)] border-[#00a86b24]" : "bg-[linear-gradient(135deg,_#eef7ff_0%,_#e0f1ff_100%)] border-[#0077b624]";
  return <div className={`rounded-[24px] border p-5 ${classes}`}><p className="text-sm font-black">{title}</p><p className="mt-2 leading-7 text-[#10233fcc]">{children}</p></div>;
}

function MiniSurfaceCard({ title, copy }: { title: string; copy: string }) {
  return <div className="rounded-[24px] border border-[#10233f18] bg-white/80 p-4 shadow-sm"><p className="text-sm font-black">{title}</p><p className="mt-2 text-sm leading-6 text-[#10233fcc]">{copy}</p></div>;
}

function CapabilityCard({ title, body, tag }: { title: string; body: string; tag: string }) {
  return (
    <div className="rounded-[28px] border border-[#10233f18] bg-white/92 p-6 shadow-[0_18px_60px_rgba(16,35,63,0.08)]">
      <div className="inline-flex rounded-full bg-[#10233f] px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-white">{tag}</div>
      <h3 className="mt-4 text-2xl font-black">{title}</h3>
      <p className="mt-3 leading-7 text-[#10233fcc]">{body}</p>
    </div>
  );
}

function SurfaceCard({ title, children }: { title: string; children: ReactNode }) {
  return <div className="rounded-[28px] border border-[#10233f18] bg-white/92 p-6 shadow-[0_18px_60px_rgba(16,35,63,0.08)]"><h3 className="text-xl font-black">{title}</h3><ul className="mt-4 space-y-2 text-sm">{children}</ul></div>;
}

function TableHead({ children }: { children: ReactNode }) {
  return <th className="px-4 py-4 text-sm font-black">{children}</th>;
}

function TableCell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-4 align-top text-sm leading-7 text-[#10233fcc] ${className}`}>{children}</td>;
}

function ValueStack({ title, items }: { title: string; items: Array<{ label: string; value: number; color: string }> }) {
  return (
    <div className="rounded-[24px] border border-[#10233f18] bg-[#fbf8f2] p-4">
      <p className="text-base font-black">{title}</p>
      <div className="mt-4 flex h-56 overflow-hidden rounded-[20px]">
        {items.map((item) => (
          <div key={item.label} className={`${item.color} flex items-end justify-center px-2 pb-3 text-center text-xs font-bold text-[#10233f]`} style={{ width: `${item.value}%` }}>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-2 text-sm">
        {items.map((item) => <div key={item.label} className="flex items-center justify-between"><span>{item.label}</span><span className="font-bold">{item.value}%</span></div>)}
      </div>
    </div>
  );
}

function TimelineItem({ number, children }: { number: number; children: ReactNode }) {
  return <div className="flex items-start gap-4 rounded-[24px] border border-[#10233f14] bg-[#fbf8f2] p-4"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#10233f] text-sm font-black text-white">{number}</div><p className="pt-1 leading-7 text-[#10233fcc]">{children}</p></div>;
}

function UseCasePanel({ title, persona, trigger, flow, outcome, metric }: UseCaseCard) {
  return (
    <div className="rounded-[28px] border border-[#10233f18] bg-white/92 p-6 shadow-[0_18px_60px_rgba(16,35,63,0.08)]">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#0077b6]">Scenario · {persona}</p>
      <h3 className="mt-2 text-2xl font-black leading-tight">{title}</h3>
      <p className="mt-4 rounded-[18px] bg-[#f4efe4] px-4 py-3 text-sm leading-7 text-[#10233fcc]"><span className="font-black text-[#10233f]">觸發情境:</span>{trigger}</p>
      <div className="mt-5 space-y-3">
        {flow.map((step, index) => <div key={step} className="flex gap-3"><span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#00a86b] text-xs font-black text-white">{index + 1}</span><p className="leading-7 text-[#10233fcc]">{step}</p></div>)}
      </div>
      <div className="mt-5 rounded-[20px] border border-[#00a86b24] bg-[linear-gradient(135deg,_#ecfff6_0%,_#ddf8e7_100%)] px-4 py-4"><p className="text-sm font-black">預期成果</p><p className="mt-2 leading-7 text-[#10233fcc]">{outcome}</p></div>
      <div className="mt-3 rounded-[16px] border border-[#0077b624] bg-[#eef7ff] px-4 py-3 text-sm font-bold text-[#0077b6]">關鍵指標 · {metric}</div>
    </div>
  );
}

function QuoteCard({ title, body }: { title: string; body: string }) {
  return <div className="rounded-[24px] border border-[#10233f18] bg-[#fbf8f2] p-5"><h4 className="text-lg font-black">{title}</h4><p className="mt-3 leading-7 text-[#10233fcc]">{body}</p></div>;
}

function ClosingStat({ title, body }: { title: string; body: string }) {
  return <div className="rounded-[24px] border border-white/10 bg-white/5 p-5"><h3 className="text-lg font-black">{title}</h3><p className="mt-3 leading-7 text-white/82">{body}</p></div>;
}

function ClosingMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[24px] border border-white/15 bg-white/8 p-5 text-center">
      <p className="text-4xl font-black text-[#7fe8b8]">{value}</p>
      <p className="mt-2 text-sm font-semibold text-white/80">{label}</p>
    </div>
  );
}

function RoadmapCard({ phase, title, status, items, tone }: { phase: string; title: string; status: string; items: string[]; tone: "green" | "blue" | "amber" | "purple" }) {
  const toneMap = {
    green: { badge: "bg-[#dcfce7] text-[#166534]", accent: "bg-[#00a86b]" },
    blue: { badge: "bg-[#dbeafe] text-[#1e40af]", accent: "bg-[#0077b6]" },
    amber: { badge: "bg-[#fef3c7] text-[#92400e]", accent: "bg-[#f59e0b]" },
    purple: { badge: "bg-[#ede9fe] text-[#5b21b6]", accent: "bg-[#7c3aed]" },
  } as const;
  const styles = toneMap[tone];
  return (
    <div className="rounded-[28px] border border-[#10233f18] bg-white/92 p-6 shadow-[0_18px_60px_rgba(16,35,63,0.08)]">
      <div className="flex items-center justify-between">
        <p className={`inline-flex rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-white ${styles.accent}`}>{phase}</p>
        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${styles.badge}`}>{status}</span>
      </div>
      <h3 className="mt-4 text-xl font-black leading-tight">{title}</h3>
      <ul className="mt-4 space-y-2 text-sm leading-7 text-[#10233fcc]">
        {items.map((item) => <li key={item} className="flex gap-2"><span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${styles.accent}`} />{item}</li>)}
      </ul>
    </div>
  );
}
