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
  trigger: string;
  flow: string[];
  outcome: string;
};

export const metadata = {
  title: "TravelSync AI Presentation",
  description: "TravelSync AI 應用介紹簡報",
};

const capabilityCards = [
  { title: "LINE 原生協作", body: "所有成員直接在 LINE 群組中聊天、投票、查詢狀態與收到提醒，不需要額外下載獨立 App。", tag: "入口" },
  { title: "AI 對話解析", body: "系統會把聊天中的地點、日期、偏好、連結與待辦轉成可追蹤的旅行資料與看板項目。", tag: "AI" },
  { title: "共享旅行看板", body: "以 To-Do、Pending Vote、Confirmed 統一團隊狀態，讓每個人看到同一份最新版本。", tag: "協作" },
  { title: "執行期指揮中心", body: "Readiness 與 Ops 將規劃資料轉成出發前準備、當日行動、風險與下一步。", tag: "營運" },
  { title: "旅費分帳", body: "記錄誰先付款、誰需要分攤，以及最低轉帳次數的結算建議。", tag: "金流" },
  { title: "事件應變支援", body: "當發生延誤、遺失護照或找不到人時，可用 /incident 啟動對應 playbook 與後續任務。", tag: "韌性" },
];

const commandRows: CommandRow[] = [
  { category: "建立旅程", command: "/start [目的地] [日期]", timing: "建立新旅程時", output: "建立 active trip 與群組旅程上下文", note: "輸入 /start Osaka 7/15-7/20 即可開局", status: "公開" },
  { category: "建立旅程", command: "/status", timing: "想看全局進度時", output: "顯示 To-Do / Pending / Confirmed 看板", note: "是所有規劃工作的總入口", status: "公開" },
  { category: "規劃與決策", command: "/add [項目]", timing: "想到待辦或新需求時", output: "把任務加入旅行看板", note: "例如保險、接送、簽證準備", status: "公開" },
  { category: "規劃與決策", command: "/share [url]", timing: "貼旅館、餐廳、航班連結時", output: "儲存旅遊知識與候選選項", note: "把聊天中的外部資訊轉成可追蹤資料", status: "公開" },
  { category: "規劃與決策", command: "/decide [項目]", timing: "需要開始正式決策時", output: "建立可投票的決策項目", note: "把模糊討論切換成結構化決策", status: "公開" },
  { category: "規劃與決策", command: "/option [項目] | [選項]", timing: "想補充候選方案時", output: "新增投票選項", note: "讓大家在同一個決策面板上比較", status: "公開" },
  { category: "規劃與決策", command: "/vote [項目]", timing: "要讓群組表決時", output: "啟動投票流程與 LINE 互動卡片", note: "多數決或截止後自動收斂結果", status: "公開" },
  { category: "規劃與決策", command: "/recommend [類型]", timing: "想回收群組記憶時", output: "列出聊天中提過的熱門選項", note: "優先使用群組自己的討論記憶", status: "公開" },
  { category: "規劃與決策", command: "/nudge", timing: "投票卡住或任務久未更新時", output: "提醒尚未處理的投票與事項", note: "降低主揪人工追人的成本", status: "公開" },
  { category: "執行與營運", command: "/ready", timing: "出發前確認準備度時", output: "Readiness 摘要、阻塞項與缺失資訊", note: "只根據 committed trip details 產出", status: "公開" },
  { category: "執行與營運", command: "/ops", timing: "旅行進行中需要大局視圖時", output: "階段、下一步、風險、資料新鮮度", note: "是執行期 command center 的聊天版", status: "公開" },
  { category: "執行與營運", command: "/incident [狀況]", timing: "發生延誤、走散、遺失證件時", output: "對應 incident playbook 與後續任務", note: "例：/incident I lost my passport", status: "公開" },
  { category: "執行與營運", command: "/booked [項目] [確認碼]", timing: "已完成預訂但尚未登記時", output: "把 confirmed item 標記為已訂", note: "屬於進階命令，目前未列在 help 清單", status: "進階" },
  { category: "旅費管理", command: "/exp [金額] [說明]", timing: "有人先代墊時", output: "記錄支出並分攤到成員", note: "支援指定對象或全員平均分攤", status: "公開" },
  { category: "旅費管理", command: "/exp-summary", timing: "結算當下或旅程結束前", output: "餘額與最少轉帳次數的結算建議", note: "降低誰該轉給誰的溝通成本", status: "公開" },
  { category: "旅程生命週期", command: "/cancel", timing: "旅程取消時", output: "取消目前 active trip", note: "保留系統狀態一致性", status: "公開" },
  { category: "旅程生命週期", command: "/complete", timing: "旅程結束時", output: "標記目前旅程完成", note: "可搭配後續資料保留與清理策略", status: "公開" },
  { category: "隱私與支援", command: "/optout", timing: "成員不想被解析訊息時", output: "停止訊息解析", note: "尊重群組中的個人隱私選擇", status: "公開" },
  { category: "隱私與支援", command: "/optin", timing: "重新加入解析時", output: "恢復訊息解析", note: "與 /optout 配對", status: "公開" },
  { category: "隱私與支援", command: "/help", timing: "想看完整指令時", output: "回傳指令總覽", note: "LIFF help 頁也使用同一份 command catalog", status: "公開" },
];

const useCases: UseCaseCard[] = [
  {
    title: "情境一：朋友群開始規劃大阪自由行",
    trigger: "群組在 LINE 討論住宿、餐廳與出發日期，但訊息快速累積。",
    flow: [
      "主揪輸入 /start 建立旅程，系統建立旅程上下文。",
      "大家自然聊天或貼連結，TravelSync AI 解析資訊並加入看板。",
      "主揪用 /decide、/option、/vote 把住宿與餐廳收斂成正式決策。",
      "旅程重要事項在 LIFF dashboard 上以待辦、投票中、已確認呈現。",
    ],
    outcome: "把零散聊天轉成可執行的共同看板，降低群組資訊流失。",
  },
  {
    title: "情境二：出發前三天確認是否真的可以順利出門",
    trigger: "大家已經決定住宿與交通，但還不知道誰沒訂房、誰沒完成準備。",
    flow: [
      "主揪輸入 /ready，系統產出 readiness snapshot。",
      "畫面會列出 completed、blockers、missing inputs 與 confidence。",
      "如果有已決定但未預訂的項目，可用 /booked 或 LIFF board 補上確認碼。",
      "接著用 /ops 看下一步、風險與當前旅行階段。",
    ],
    outcome: "把『好像差不多了』變成『哪些真的完成、哪些還有風險』。",
  },
  {
    title: "情境三：旅行途中臨時出狀況",
    trigger: "班機延誤、找不到同行者，或有人遺失護照。",
    flow: [
      "成員輸入 /incident flight delay 或 /incident I lost my passport。",
      "系統匹配 incident playbook，回覆建議步驟與風險說明。",
      "必要時自動在 trip board 建立 follow-up tasks。",
      "Ops 與 readiness 檢視畫面會同步反映新風險與待處理事項。",
    ],
    outcome: "在高風險時刻提供結構化應對，而不是只停留在群聊混亂討論。",
  },
];

const surfaces = [
  { title: "LINE 群組聊天", bullets: ["接收 slash commands", "回覆摘要、提醒與 playbook", "保留最低學習成本"] },
  { title: "LIFF Dashboard", bullets: ["看板管理", "Readiness 詳細檢查", "Operations 大局總覽"] },
  { title: "Webhook + 背景處理", bullets: ["快速回應 LINE", "事件持久化", "非同步處理解析與通知"] },
  { title: "Supabase 狀態層", bullets: ["旅程資料", "事件紀錄", "readiness / incidents / alerts"] },
];

const categoryCounts = [
  { label: "規劃與決策", value: commandRows.filter((row) => ["建立旅程", "規劃與決策"].includes(row.category)).length, color: "from-[#00a86b] to-[#7fe8b8]" },
  { label: "執行與營運", value: commandRows.filter((row) => row.category === "執行與營運").length, color: "from-[#0077b6] to-[#72d6ff]" },
  { label: "旅費管理", value: commandRows.filter((row) => row.category === "旅費管理").length, color: "from-[#f59e0b] to-[#ffd166]" },
  { label: "生命週期與支援", value: commandRows.filter((row) => ["旅程生命週期", "隱私與支援"].includes(row.category)).length, color: "from-[#7c3aed] to-[#c4b5fd]" },
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
            <h1 className="mt-1 text-lg font-black tracking-tight">應用能力與流程簡報</h1>
          </div>
          <nav className="hidden flex-wrap gap-2 text-sm lg:flex">
            <NavPill href="#overview">總覽</NavPill>
            <NavPill href="#commands">指令</NavPill>
            <NavPill href="#flow">流程</NavPill>
            <NavPill href="#use-cases">使用情境</NavPill>
            <NavPill href="#architecture">架構</NavPill>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <section className="grid min-h-[88vh] items-center gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#10233f1a] bg-white/70 px-4 py-2 text-sm font-semibold text-[#00a86b] shadow-sm">
              <span className="h-2 w-2 rounded-full bg-[#00a86b]" />
              專為 LINE 群組旅遊規劃與執行設計
            </div>
            <div className="space-y-4">
              <h2 className="max-w-4xl text-5xl font-black leading-[1.02] tracking-tight md:text-6xl">
                把群聊中的旅行雜訊，
                <span className="block text-[#0077b6]">變成可執行的共同旅程系統。</span>
              </h2>
              <p className="max-w-3xl text-lg leading-8 text-[#10233fcc]">
                TravelSync AI 是一個結合 LINE Bot、LIFF Web App、AI 訊息解析、旅行看板、readiness 檢查、operations summary、incident playbook 與旅費分帳的團體旅行協作平台。
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <StatCard value="20" label="已實作指令數" />
              <StatCard value="3" label="主要使用介面" />
              <StatCard value="7+" label="旅行資料子系統" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <AccentPanel title="一句話定位" tone="green">協助群組從「討論去哪、住哪、吃什麼」一路走到「誰還沒準備好、今天下一步是什麼、臨時出事怎麼辦」。</AccentPanel>
              <AccentPanel title="最核心差異" tone="blue">不只是規劃工具，而是把聊天、決策、執行、提醒、分帳和風險管理串在同一個協作閉環。</AccentPanel>
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
              <MiniSurfaceCard title="LIFF 中深度查看" copy="看板、readiness、ops、旅費與行程" />
            </div>
          </div>
        </section>

        <section id="overview" className="py-10">
          <SectionHeader eyebrow="Overview" title="產品能力地圖" body="TravelSync AI 的價值不只在 AI 解析，而是把旅行規劃、決策、執行與旅後結算放進同一套團隊工作流。" />
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {capabilityCards.map((card) => <CapabilityCard key={card.title} {...card} />)}
          </div>
        </section>

        <section className="py-10">
          <SectionHeader eyebrow="Channels" title="使用介面與責任分工" body="同一個應用，同時提供聊天協作介面與行動端 LIFF 視覺介面，後端則透過 webhook、排程與資料庫狀態維持一致。" />
          <div className="grid gap-4 xl:grid-cols-4">
            {surfaces.map((surface) => (
              <SurfaceCard key={surface.title} title={surface.title}>
                {surface.bullets.map((bullet) => <li key={bullet} className="leading-7 text-[#10233fcc]">{bullet}</li>)}
              </SurfaceCard>
            ))}
          </div>
        </section>

        <section id="commands" className="py-10">
          <SectionHeader eyebrow="Commands" title="完整指令總覽" body="這一頁可直接拿來對外說明 TravelSync AI 能做什麼。表格內容依照目前專案中的 command handlers 與 command catalog 整理。" />
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
        </section>

        <section className="py-10">
          <SectionHeader eyebrow="Charts" title="指令能力分布圖" body="以下圖表不是虛構商業數字，而是根據目前程式中已存在的 20 個指令，依功能面向重新分類後得到的能力分布。" />
          <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
            <Panel>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#f59e0b]">Chart 01</p>
                  <h3 className="mt-1 text-2xl font-black">功能模組橫向柱狀圖</h3>
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
              <p className="mt-6 text-sm leading-7 text-[#10233fcc]">這個圖表表達的是 TravelSync AI 在不同旅行階段的功能覆蓋重心，強調它從「規劃工具」一路延伸到「執行期協作系統」。</p>
            </Panel>
          </div>
        </section>

        <section id="flow" className="py-10">
          <SectionHeader eyebrow="Flow" title="使用流程與系統流程" body="下面這張圖可以直接放進簡報中，說明使用者如何從 LINE 對話進入 TravelSync AI 的資料循環，再回到聊天與 LIFF 畫面。" />
          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <Panel className="overflow-hidden">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#0077b6]">Image 02</p>
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
                  "使用者在 LINE 群組自然聊天，或直接輸入 slash command。",
                  "LINE webhook 先驗證簽章，再把事件寫入資料庫，確保可追蹤與可重試。",
                  "背景流程依事件類型處理：若是指令就 route 到對應 handler；若是普通訊息就交給 AI parsing pipeline。",
                  "服務層把資料轉成看板項目、readiness snapshot、operations summary、incident tasks 或 expense settlement。",
                  "結果一方面回推到 LINE 群組，一方面同步到 LIFF dashboard / readiness / operations 視圖。",
                  "排程工作持續執行 daily briefings、stale reminders、transport monitoring 與 cleanup。",
                ].map((item, index) => (
                  <TimelineItem key={item} number={index + 1}>{item}</TimelineItem>
                ))}
              </div>
            </Panel>
          </div>
        </section>

        <section id="use-cases" className="py-10">
          <SectionHeader eyebrow="Use Cases" title="三個最容易理解產品價值的使用情境" body="這些情境對應目前程式中已存在的 commands、LIFF 頁面與 service 模組，適合在簡報中當作功能串講腳本。" />
          <div className="mb-6 overflow-hidden rounded-[28px] border border-[#10233f18] bg-white p-5 shadow-[0_18px_60px_rgba(16,35,63,0.08)]">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#f59e0b]">Image 03</p>
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

        <section className="py-10">
          <SectionHeader eyebrow="UI Story" title="從聊天到視覺畫面的產品敘事" body="TravelSync AI 並不是把所有事情都塞在同一個畫面，而是把不同旅行階段切到最適合的介面：聊天用來互動、LIFF 用來理解狀態。" />
          <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <Panel>
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#7c3aed]">Image 04</p>
                  <h3 className="mt-1 text-2xl font-black">指令能力地圖</h3>
                </div>
                <div className="rounded-full bg-[#f4efe4] px-3 py-1 text-xs font-bold text-[#10233f]">指令導向</div>
              </div>
              <Image src="/presentation/command-landscape.svg" alt="TravelSync AI command landscape" width={1600} height={900} className="w-full rounded-[24px] border border-[#10233f12]" />
            </Panel>

            <Panel>
              <h3 className="text-2xl font-black">可這樣介紹介面切換</h3>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <NarrativeCard title="聊天介面做什麼" points={["快速輸入命令", "接收摘要、提醒、投票結果", "在低摩擦情境下推動群組前進"]} />
                <NarrativeCard title="LIFF 介面做什麼" points={["把複雜狀態視覺化", "看到 readiness 與 ops 全貌", "適合在出發前與旅行中做深度檢查"]} />
                <NarrativeCard title="後端服務做什麼" points={["持久化事件", "解析訊息與生成結構化資料", "排程處理摘要、提醒與監控"]} />
                <NarrativeCard title="為什麼這樣設計" points={["避免資訊只停留在聊天紀錄中", "讓群組成員共享同一份事實", "在高風險時刻仍然能快速反應"]} />
              </div>
            </Panel>
          </div>
        </section>

        <section id="architecture" className="py-10">
          <SectionHeader eyebrow="Architecture" title="技術架構摘要" body="若聽眾想知道這不是一個單純 mockup，而是真正可運作的系統，這一頁可以快速回答『它如何工作』。" />
          <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
            <Panel>
              <div className="overflow-hidden rounded-[24px] border border-[#10233f12]">
                <table className="min-w-full border-collapse">
                  <thead className="bg-[#10233f] text-white">
                    <tr>
                      <TableHead>層級</TableHead>
                      <TableHead>目前實作重點</TableHead>
                      <TableHead>可對外解讀的價值</TableHead>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="bg-[#fffdf9]"><TableCell className="font-semibold text-[#0077b6]">前端入口</TableCell><TableCell>Landing page、LIFF dashboard、readiness、operations、help</TableCell><TableCell>聊天與視覺化體驗並存</TableCell></tr>
                    <tr className="bg-[#f8f4eb]"><TableCell className="font-semibold text-[#0077b6]">Bot 互動層</TableCell><TableCell>router + 20 個指令 handler</TableCell><TableCell>可自然融入 LINE 群組流程</TableCell></tr>
                    <tr className="bg-[#fffdf9]"><TableCell className="font-semibold text-[#0077b6]">服務層</TableCell><TableCell>parsing、memory、decisions、readiness、operations、incidents、expenses</TableCell><TableCell>讓功能可模組化擴張</TableCell></tr>
                    <tr className="bg-[#f8f4eb]"><TableCell className="font-semibold text-[#0077b6]">資料層</TableCell><TableCell>Supabase trip、events、raw messages、readiness、alerts 等表</TableCell><TableCell>保留狀態一致性與可追蹤性</TableCell></tr>
                    <tr className="bg-[#fffdf9]"><TableCell className="font-semibold text-[#0077b6]">排程與韌性</TableCell><TableCell>cron process-events、daily-briefings、readiness-refresh、transport-monitor、cleanup</TableCell><TableCell>可持續運作，不依賴單次 webhook 成功</TableCell></tr>
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel>
              <h3 className="text-2xl font-black">對外說明時的三個重點</h3>
              <div className="mt-6 space-y-4">
                <QuoteCard title="1. 不是只會回覆指令的 Bot" body="TravelSync AI 把訊息解析、結構化資料、可視化看板、營運摘要與 incident 應變串起來，因此它更像旅行協作系統，而不是單純聊天機器人。" />
                <QuoteCard title="2. 不是只服務規劃期" body="透過 /ready、/ops 與 /incident，它已經跨進出發前與旅行中的執行管理，這也是產品的差異化亮點。" />
                <QuoteCard title="3. 不是只靠即時回覆" body="系統有事件持久化、重試與 cron 背景流程，所以能處理提醒、摘要、監控與清理等持續性工作。" />
              </div>
            </Panel>
          </div>
        </section>

        <section className="pb-14 pt-10">
          <div className="overflow-hidden rounded-[36px] border border-[#10233f18] bg-[#10233f] px-8 py-10 text-white shadow-[0_22px_80px_rgba(16,35,63,0.24)]">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[#7fe8b8]">Closing Slide</p>
            <h2 className="mt-3 max-w-4xl text-4xl font-black leading-tight">TravelSync AI 的核心價值，是把「聊天中的旅行規劃」升級成「可共享、可執行、可持續追蹤的團體旅行作業系統」。</h2>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <ClosingStat title="對主揪的價值" body="少追人、少整理、少遺漏，更多自動化收斂與提醒。" />
              <ClosingStat title="對團員的價值" body="知道自己要做什麼，不必回頭翻大量群組訊息。" />
              <ClosingStat title="對產品的價值" body="從規劃工具延伸為旅行執行層，提高黏著與差異化。" />
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

function StatCard({ value, label }: { value: string; label: string }) {
  return <div className="rounded-[24px] border border-[#10233f18] bg-white/80 px-5 py-4 shadow-sm"><p className="text-3xl font-black text-[#00a86b]">{value}</p><p className="mt-1 text-sm font-semibold text-[#10233fcc]">{label}</p></div>;
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

function UseCasePanel({ title, trigger, flow, outcome }: UseCaseCard) {
  return (
    <div className="rounded-[28px] border border-[#10233f18] bg-white/92 p-6 shadow-[0_18px_60px_rgba(16,35,63,0.08)]">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#0077b6]">Scenario</p>
      <h3 className="mt-2 text-2xl font-black leading-tight">{title}</h3>
      <p className="mt-4 rounded-[18px] bg-[#f4efe4] px-4 py-3 text-sm leading-7 text-[#10233fcc]"><span className="font-black text-[#10233f]">觸發情境：</span>{trigger}</p>
      <div className="mt-5 space-y-3">
        {flow.map((step, index) => <div key={step} className="flex gap-3"><span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#00a86b] text-xs font-black text-white">{index + 1}</span><p className="leading-7 text-[#10233fcc]">{step}</p></div>)}
      </div>
      <div className="mt-5 rounded-[20px] border border-[#00a86b24] bg-[linear-gradient(135deg,_#ecfff6_0%,_#ddf8e7_100%)] px-4 py-4"><p className="text-sm font-black">預期成果</p><p className="mt-2 leading-7 text-[#10233fcc]">{outcome}</p></div>
    </div>
  );
}

function NarrativeCard({ title, points }: { title: string; points: string[] }) {
  return <div className="rounded-[24px] border border-[#10233f18] bg-[#fbf8f2] p-5"><h4 className="text-lg font-black">{title}</h4><div className="mt-4 space-y-2">{points.map((point) => <p key={point} className="leading-7 text-[#10233fcc]">{point}</p>)}</div></div>;
}

function QuoteCard({ title, body }: { title: string; body: string }) {
  return <div className="rounded-[24px] border border-[#10233f18] bg-[#fbf8f2] p-5"><h4 className="text-lg font-black">{title}</h4><p className="mt-3 leading-7 text-[#10233fcc]">{body}</p></div>;
}

function ClosingStat({ title, body }: { title: string; body: string }) {
  return <div className="rounded-[24px] border border-white/10 bg-white/5 p-5"><h3 className="text-lg font-black">{title}</h3><p className="mt-3 leading-7 text-white/82">{body}</p></div>;
}
