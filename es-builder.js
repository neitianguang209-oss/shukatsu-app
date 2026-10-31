// ESビルダー(Coworkの「Es Shibou Builder (プログラム連動版)」を移植)
// 正本は Cowork の es-builder-program.html。プロンプトの文言(crossRules / rulesText / structureTemplates /
// consistencyRules / programReflectionRules / questionListBlock / outputFormatText / buildFullPrompt)は原文のまま。
// 移植で変えたところ:
//  - ベース情報(学年・エピソード・自己分析)は localStorage ではなく自分データベース(shukatsu_profile.builder / shukatsu_episodes)から読む
//  - 「Claudeに書いてもらう」= 組み立てたプロンプトを shukatsu_queue に入れて claude.ai を開く。書いた本文は shukatsu_es_answers に戻る
//  - 自動読み取りは Cowork の askClaude が無いので正規表現の簡易版だけ。貼った原文はプロンプトにも添える
//  - 締め方は設問ごとに選ぶ(おすすめ=recommendClose)。横断ルールCと構成テンプレの締めの行はそれに合わせて書き換えた
//  - 書き上げ済みのES(status '完成版')を手本としてプロンプトに添える
// shukatsu-plus.js のあとに読み込む(plus / plusApi / plusEntryForCompany などを使う)。

const esBuilder = (() => {
  const P = "eb_";
  const $ = id => document.getElementById(P + id);
  const val = id => ($(id) ? $(id).value.trim() : "");
  const DRAFT_KEY = "shukatsu:builderDraft";
  const INDUSTRIES = ["コンサル","金融","商社","メーカー","インフラ","IT・SaaS","その他"];
  const KINDS = ["本選考","インターン","1day仕事体験"];
  let ctx = { entry_id: "", program: "" };   // 会社画面から開いたときの紐づけ
  let baseFilled = false, lastOutput = "";

  function getKind(){ const r = document.querySelector('input[name=eb_kind]:checked'); return r ? r.value : "本選考"; }
  function isIntern(){ return getKind() !== "本選考"; }
  function refreshKind(){
    const intern = isIntern();
    $("internKind").classList.toggle("show", getKind()==="インターン");
    $("kindHint").textContent = intern
      ? "▶ 志望動機系の設問はインターン構成:結論/このインターンでしか得られない経験/自分の課題/交わる点/挑戦したいこと&持ち帰りたいもの。"
      : "▶ 志望動機系の設問は本選考構成:結論/会社軸(中計・注力領域・独自の強み)/自分軸(原体験を1つ)/交わる点/入社後に挑戦したいこと。";
  }

  // --- 応募先プログラム ---
  function hasProgram(){ return !!(val("progContent") || val("progTrack")); }
  function programBlock(){
    const lines = [];
    if(val("progContent")) lines.push(val("progContent"));
    if(val("progTrack")) lines.push("・応募トラック: "+val("progTrack"));
    return lines.join("\n");
  }
  function programReflectionRules(){
    if(!hasProgram()) return "";
    return `- 上記「応募先プログラムの内容」を必ず読み込み、志望動機系の設問に反映する:
  ・キャッチコピー/募集メッセージを企業理念(パーパス・ブランドコンセプト)と結びつけ、設問の冒頭か締めに接続する
  ・「こんな方におすすめ」の文言を自分軸に紐づける(例:「課題解決が好きな方」歓迎 → 自分の課題解決経験に直結させる)
  ・複数プログラムがある場合、応募トラックの趣旨に合わせて語る経験と締めの方向を寄せる(例:1day=事業全体像の理解/2days=戦略立案・経営視点)
  ・プログラム固有名詞(プログラム名・登壇部門・拠点名・テーマ等)を最低1つ志望動機に入れる
  ・プログラム内容に書かれていない事実(日数・テーマ等)を勝手に創作しない。記載がなければ会社研究の範囲で書く`;
  }

  // =====================================================
  // エピソード集(自分データベースの shukatsu_episodes)
  // =====================================================
  function periodOf(ep){
    const s = (ep.period || "") + " " + (ep.title || "");
    const p = ep.period || "";
    if (/中学/.test(p)) return "中学";
    if (/高校/.test(p)) return "高校";
    if (/大学|院/.test(p) || /20(2[4-8])/.test(p)) return /院/.test(p) ? "院" : "大学";
    if (/中学/.test(s)) return "中学";
    if (/高校/.test(s)) return "高校";
    return "その他";
  }
  function epText(ep){
    const parts = [["状況", ep.situation], ["課題", ep.challenge], ["行動", ep.actions], ["結果", ep.result], ["数字", ep.numbers], ["学び", ep.learning]]
      .filter(([, v]) => v).map(([k, v]) => `${k}:${v}`);
    if (ep.open_questions) parts.push(`(未確認の点・本文で断定しない:${ep.open_questions})`);
    if (ep.status && ep.status !== "確定") parts.push(`(本人の確認待ちのエピソード)`);
    return parts.join(" ");
  }
  function getEpisodes(){
    return (plus.episodes || []).map(ep => ({
      id: ep.id, label: ep.title || "", text: epText(ep), period: periodOf(ep), strength: (ep.strengths || []).join("・")
    })).filter(e => e.text);
  }

  // =====================================================
  // 設問リスト(複数設問)
  // =====================================================
  // 締め方は設問ごとに選ぶ(2026-11-01 本人の希望で追加。既定は設問文からのおすすめ)
  const CLOSES = {
    "学び":   { label: "事実・学びで締める", rule: "事実・学びで締める(例「〜した経験です」「〜を学びました」)。強みの言い切りにしない" },
    "身につき": { label: "「〜する力が身につきました」", rule: "「〜する力が身につきました」の形で、学びを力の言葉にして締める" },
    "強み":   { label: "「〜が私の強みです」", rule: "「〜が私の強みです」で締める(入社後の活かし方を添えてよい)" },
    "志望":   { label: "入社後/参加中にしたいこと", rule: "入社後(インターンなら参加中)に挑戦したいこと・持ち帰りたいもので締める" },
  };
  function recommendClose(q){
    if(/強み|自己\s*PR|自己ピーアール|長所|アピール/i.test(q)) return "強み";
    if(/志望|なぜ当社|なぜ弊社|参加したい|応募した理由|期待すること|入社後|当社で|弊社で/.test(q)) return "志望";
    if(/困難|挫折|失敗|乗り越え|苦労|壁|逆境/.test(q)) return "学び";
    if(/学んだ|得た|身につけ|身に付け|成長/.test(q)) return "身につき";
    if(/力を入れ|打ち込|注力|ガクチカ|学生時代|頑張った/.test(q)) return "身につき";
    return "学び";
  }
  function closeOf(q){ return q.close && CLOSES[q.close] ? q.close : recommendClose(q.text); }
  function buildCloseSelect(sel, text, selected){
    const cur = selected !== undefined ? selected : sel.value;
    const rec = recommendClose(text);
    sel.innerHTML = `<option value="auto">おすすめ:${CLOSES[rec].label}</option>` +
      Object.entries(CLOSES).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join("");
    sel.value = cur && (cur === "auto" || CLOSES[cur]) ? cur : "auto";
  }

  function isExperienceQ(q){
    if(!q) return false;
    return /ガクチカ|学生時代|力を入れ|注力した|打ち込ん|自己\s*PR|自己ピーアール|あなたの強み|強みを|長所|困難|挑戦したこと|成し遂げ|成果|経験を教え|頑張ったこと|苦労した/i.test(q);
  }
  function addQuestion(text="", chars="400", ep="auto", esId="", close="auto"){
    const div = document.createElement("div");
    div.className = "eb-qrow";
    div.dataset.esId = esId;
    div.innerHTML = `
      <div class="eb-qhead"><span class="eb-qnum">設問<span class="q-num"></span></span>
        <span class="eb-qtype"></span>
        <button type="button" class="eb-qdel" title="削除">✕</button></div>
      <textarea class="q-text" placeholder="設問文をそのまま貼り付け(例:当社を志望する理由を教えてください)"></textarea>
      <div class="eb-row" style="margin-top:6px">
        <div style="flex:0 0 96px;min-width:0">
          <label>文字数</label>
          <input type="number" class="q-chars" min="50" max="2000" inputmode="numeric">
        </div>
        <div>
          <label>主役にするエピソード <span class="eb-hint">(基本は自動でOK)</span></label>
          <select class="q-ep"></select>
        </div>
      </div>
      <label style="margin-top:6px">締め方 <span class="eb-hint">(設問に合わせたおすすめ。変えてもOK)</span></label>
      <select class="q-close"></select>`;
    div.querySelector(".q-text").value = text;
    div.querySelector(".q-chars").value = chars || "400";
    div.querySelector(".eb-qdel").onclick = ()=>{ div.remove(); renumberQuestions(); saveDraft(); };
    div.querySelector(".q-text").addEventListener("input", ()=>updateQType(div));
    $("qList").appendChild(div);
    buildEpSelect(div.querySelector(".q-ep"), ep);
    buildCloseSelect(div.querySelector(".q-close"), text, close);
    renumberQuestions(); updateQType(div);
    return div;
  }
  function renumberQuestions(){
    document.querySelectorAll("#eb_qList .eb-qrow .q-num").forEach((s,i)=>s.textContent = i+1);
  }
  function updateQType(row){
    const t = row.querySelector(".q-text").value.trim();
    const tag = row.querySelector(".eb-qtype");
    if(isExperienceQ(t)){ tag.textContent = "経験・強み系 → PREP型"; tag.classList.add("exp"); }
    else { tag.textContent = "志望動機・その他"; tag.classList.remove("exp"); }
    const cs = row.querySelector(".q-close");
    if (cs) buildCloseSelect(cs, t);
  }
  function buildEpSelect(sel, selected){
    const eps = getEpisodes();
    const cur = selected !== undefined ? selected : sel.value;
    sel.innerHTML = "";
    const opt = (v, t)=>{ const o=document.createElement("option"); o.value=v; o.textContent=t; sel.appendChild(o); };
    opt("auto", "自動(おすすめ:AIが最適に割り当て)");
    eps.forEach((e,i)=>opt(e.id, `エピソード${i+1}${e.label?":"+e.label.slice(0,18):""}`));
    opt("none", "エピソードを主役にしない");
    sel.value = [...sel.options].some(o=>o.value===cur) ? cur : "auto";
  }
  function refreshEpSelects(){
    document.querySelectorAll("#eb_qList .eb-qrow .q-ep").forEach(s=>buildEpSelect(s));
  }
  function getQuestions(){
    return [...document.querySelectorAll("#eb_qList .eb-qrow")].map(r=>({
      text: r.querySelector(".q-text").value.trim(),
      chars: parseInt(r.querySelector(".q-chars").value||"400",10),
      ep: r.querySelector(".q-ep").value,
      close: r.querySelector(".q-close").value,
      esId: r.dataset.esId || ""
    })).filter(q=>q.text);
  }
  function clearQuestions(){ $("qList").innerHTML=""; }

  // =====================================================
  // プロンプト部品(原文のまま)
  // =====================================================
  function companyLabel(){
    const c = val("company") || "(会社名未入力)";
    const kind = getKind();
    const kindStr = getKind()==="インターン" && val("internType") ? `インターン(${val("internType")})` : kind;
    return {c, kindStr};
  }
  function researchBlock(){ return ""; }       // 会社研究メモ欄は削除済み(仕様書 3章)
  function internAnswers(){ return ""; }       // インターン深掘り回答欄は削除済み
  function episodesBlock(){
    const eps = getEpisodes();
    if(!eps.length) return "(未登録)";
    return eps.map((e,i)=>{
      const tags = [e.period?`時期:${e.period}`:"", e.strength?`強み:${e.strength}`:""].filter(Boolean).join(" / ");
      return `・エピソード${i+1}${e.label?`(${e.label})`:""}${tags?` 〔${tags}〕`:""}: ${e.text}`;
    }).join("\n");
  }
  function questionListBlock(){
    const qs = getQuestions();
    const eps = getEpisodes();
    return qs.map((q,i)=>{
      const type = isExperienceQ(q.text) ? "経験・強み系(PREP型で書く)" : "志望動機・その他(応募種別の構成で書く)";
      let epStr = "自動(最適なエピソードを割り当てる)";
      let noneNote = "";
      if(q.ep==="none"){
        epStr = "エピソードを主役にしない";
        noneNote = "\n・この設問は具体エピソードを主役にせず、設問そのものに端的に答える。考え方・想い・価値観は自分史に沿って自然な自分の言葉で書く。ただし「無印では」「長期インターンでは」のような所属・種別の枕詞や定型の前置きは入れない。";
      }
      else if(q.ep!=="auto"){ const n = eps.findIndex(e=>e.id===q.ep); const e = eps[n]; if(e) epStr = `エピソード${n+1}${e.label?"("+e.label+")":""}を必ず主役に使う`; }
      const closeStr = `${CLOSES[closeOf(q)].rule}${q.close==="auto" ? "(設問の内容からのおすすめ)" : "(本人の指定)"}`;
      return `【設問${i+1}】${q.text}\n・字数: ${q.chars}字の95〜100%(末尾に実字数を明記)\n・構成タイプ: ${type}\n・使用エピソード: ${epStr}\n・締め方: ${closeStr}${noneNote}`;
    }).join("\n\n");
  }
  function structureTemplates(){
    const exp =
`■ 経験・強み系の設問 → PREP型で書く
【結論の書き出しルール】冒頭の一文は、設問文の言葉をオウム返しして答える(設問の動詞に主語を合わせる)。
・設問「力を入れて取り組んだこと」→「私が最も力を入れたのは〜です」
・設問「あなたの強み」「自己PR」→「私の強みは〜です」
・設問「困難を乗り越えた経験」→「私が乗り越えた困難は〜です」
1 結論:上記ルールに従い、設問へのオウム返しで一文回答する
2 エピソード:課題 → 転機 → 行動 → 結果 の順で具体的に展開する
3 締め:強みの言い切りは冒頭ではなく締めの一文に置く。締めの形は設問一覧の「締め方」に従う
※短い字数のときは「1感情の機微 → 2具体策の細部」の順に削り、結論・転機・結果は必ず残す`;
    const motive = isIntern() ?
`■ 志望動機系の設問 → インターン構成
1 結論:一文で「なぜこのインターンか」を言い切る(“成長したい”で止めず、何をどう得たいかまで)
2 会社軸:このインターンでしか得られない経験(事業の固有名詞・プログラム内容・社員と関わる機会)に注目する理由
3 自分軸:これまでの経験から見えた自分の課題・伸ばしたい力・確かめたい仮説を具体的に
4 交わる点:2の環境で3がどう前進するか(“なぜ他社でなくここか”まで含める)
5 挑戦したいこと&持ち帰りたいもの:参加中に実行したい行動と、終了時にどう変わっていたいか` :
`■ 志望動機系の設問 → 本選考構成
1 結論:一文で「なぜ貴社か」を言い切る
2 会社軸:中期経営計画の戦略名・注力領域・独自の強みを固有名詞で挙げて注目理由を述べる
3 自分軸:原体験・価値観・強みを一つに絞って提示
4 交わる点:2と3が交差する地点を論理的に接続(説得力の核)
5 貴社でしたいこと:入社後に挑戦したいこと(部署名・事業名レベルで具体化)`;
    return exp + "\n\n" + motive;
  }
  function crossRules(){
    return `【最優先の横断ルール(A〜F)】これらを土台にし、表現細則より優先する。
A. エピソード設計(手戻り防止の最重要):
  - 各エピソードの〔時期〕〔示せる強み〕を踏まえて割り当てる。タグが空欄なら本文から時期・強みを推定する。
  - 設問が時期を限定する場合(例「大学時代の経験」)、その時期のエピソード以外は使わない。自動割り当てでも時期制約を最優先する。
  - 着手前に「使用可エピソード数 ≧ 経験エピソード設問数」を確認する。足りなければ、どのネタを切り口を変えて再利用するか明示し、再利用時は課題・行動・学びの角度を必ず変える。
  - 各エピソードは〈つまずき/転機 → 具体的工夫 → 結果〉の3点で書く。欠けている要素は創作せず、不足として質問する。
B. 設問タイプは設問文から自分で判定する。「なぜ参加/志望するか」=志望動機型、「〜した経験を教えて」=経験エピソード型。与えた構成タイプのラベルが設問文と矛盾する場合は設問文を優先する。
C. 締め方:設問一覧の各設問にある「締め方」に従う(設問の内容に合わせたおすすめ、または本人の指定)。締めの型を全設問に一律強制しない。締めの一文は前段から自然に導けるものにする。
D. 字数と削り方:優先は「分かりやすさ ＞ 網羅」。1設問=1メッセージに絞る。字数に収まらないときは表現を圧縮せず、要素そのものを削り、最低限「結論」と「結果」を残す。95〜100%は維持するが、空き字数は新情報の追加でなく、一番伝えたいことを丁寧に書くために使う。
E. 変数(ぶれやすい項目=応募コース/テーマ、伸ばしたい力・なりたい状態の軸、締めで寄せたい強み)は、入力があれば最優先で従う。空欄のものがあれば、本文を書く前にまとめて1回だけ質問する。
F. 接続詞バンク・一文一義などの表現細則は「補助ルール」。A〜Eを満たした上で適用し、細則のために自然さ・分かりやすさを犠牲にしない。`;
  }
  function consistencyRules(){
    const multi = getQuestions().length > 1;
    const progLine = hasProgram() ? "\n・応募プログラムの趣旨と、各設問の主役エピソードが示す強みを揃える(例:戦略立案がテーマの回には「課題分解・選択と集中」を示すエピソードを主役に充てる)" : "";
    if(!multi){
      return progLine ? "\n【応募プログラム連動ルール】"+progLine : "";
    }
    return `
【複数設問の一貫性ルール(最重要)】
・全設問の回答を通して「人物像・強みの軸」を1本に揃える(設問ごとに別人に見えないように)
・同じエピソードを2つ以上の設問の主役にしない。エピソードが足りない場合のみ同じ経験を使ってよいが、切り口(課題/行動/学び)と表現を必ず変える
・経験系の回答で示した強みを、志望動機系の「貴社で活かせること」に接続して相互に補強する
・「使用エピソード」が指定された設問はそれに従う。「自動」の設問は最適に割り当て、必ず冒頭の割り当て表で明示する${progLine}`;
  }
  function rulesText(){
    return [
      "【絶対NG】",
      "・「社員の方々の人柄に惹かれ」等、どの会社にも当てはまる抽象表現",
      "・公式サイトのトップだけで分かる薄い言及/中計・事業の固有名詞がゼロ",
      "・「成長したい/貢献したい/学びたい」を理由で止める(→何を/なぜ/どう活かす まで踏み込む)",
      isIntern() ? "・「入社したいから参加したい」という本選考混同の表現" : "",
      "",
      "【文体】全文を「ですます調」で統一する。",
      "",
      "【字数】各設問とも指定字数の95〜100%に必ず収める。各本文の最後に実際の字数を(例:「(397字)」)明記する。",
      "短い字数のときは「1感情の機微 → 2具体策の細部」の順に削り、結論・転機・結果は必ず残す。",
      "",
      "【読みやすさ(最重要)】人事は30秒〜1分しか読まない前提。一文60字以内で短く。",
      "主語と述語を近づける。話の転換点は自然につなぐ(→表現ルールD)。接続詞の重複はなるべく避けるが、最優先は自然で能動的な文体であり、機械的なルール適用で不自然にしない。",
      "抽象語の直後に必ず具体例・固有名詞。段落は2〜3文で改行。",
      "",
      "【文法・表現の具体ルール(読みやすさ)】",
      "・一文一義:1つの文に情報は1つだけ。長くなったら切る。",
      "  ×「Aは飲食店オーナーだが兄は造り酒屋を営む」 ○「Aは飲食店オーナーだ。兄は造り酒屋を営む」",
      "・主語は文頭に置く。何についての文かを最初に示す。",
      "  ×「都市と地方の格差是正が目的のふるさと納税は2008年に始まった」 ○「ふるさと納税は、格差是正を目的に2008年に始まった」",
      "・修飾語は被修飾語のすぐ近くに置く。離すと解釈違いを招く。",
      "  ×「毎晩自宅で先生が作ったプリントを読んだ」 ○「先生が作ったプリントを毎晩自宅で読んだ」",
      "・難しい言葉・専門用語・カタカナ語を多用しない。初めてその情報に触れる人に伝える前提で平易に書く。",
      "",
      "【表現ルールA:マイナスの言い切りを避け、前向きな転機に変換する】(挫折・困難系/ガクチカで特に重要)",
      "・困難・挫折・限界を書くとき「〜できません」「勝てません」のような消極的・断定的なマイナス表現は使わない。",
      "・本人が自ら状況を分析して下した能動的な判断・気づきの形に変換し、読後感を前向きに保つ。",
      "  ×「同じ土俵で戦う限り、勝てません。」 ○「同じ土俵で戦っても勝てないと考え、仲間が狙わない場所で勝負しようと決めました。」",
      "・型:「〜できない/勝てない」→「〜できないと考え/判断し、(だから〜した)」",
      "・マイナスの事実は単独で言い切らず、直後に必ず\"次の行動\"を続けて立ち止まらせない。",
      "・挫折の描写は事実として簡潔に。感情の落ち込みを長く描かず、転機・行動へ素早く接続する。",
      "",
      "【表現ルールB:近接した同語反復を避ける(強化版)】",
      "・同じ動詞・名詞を2文以内で繰り返さない。中心語(考える/貢献する/取り組む 等)が近接重複したら片方を類語に置き換える。",
      "  ×「試合に貢献する…貢献できる場所」 → 片方を「支える」等へ",
      "※「用語統一」で固定したキーワード(鉄則/一時停止/顧客・現場・経営の三者視点 等)は対象外。これらは意図的に統一する。",
      "",
      "【表現ルールC:「目標・プロセス・成果」型の設問では目標を明示する】",
      "・設問が「目標」「プロセス」「成果」を求める場合、目標を独立した一文で言い切る(例:「〜することを目標に定めました」)。",
      "・プロセスの説明に埋もれさせず、読み手が3要素を一目で拾えるようにする。",
      "  ○「そこで、仲間が狙わない『つなぎ役』で試合を支えることを目標に定めました。」",
      "",
      "【最優先方針】自然な文体と能動的な表現を最優先する。以下の接続・反復ルールは、それを損なわない範囲で適用する指針であり、機械的に当てはめて文章を不自然にしてはならない。",
      "",
      "【表現ルールD:文のつながりを自然に保つ】",
      "・話の転換点(結論→課題→提案→障害→行動→結果→締め)は、原則として自然につなぐ。接続詞でつないでもよいし、語順や述語(〜したため/〜を受けて 等)で自然に流れるなら接続詞を無理に足さない。",
      "・特に障害・否定的事実(渋られた・伸び悩んだ等)の直後は、次の能動的な行動へ自然に流して読み手を立ち止まらせない。手段は接続詞に限らず、文の組み立てで前へ進めてよい。",
      "  ×「店長に渋られました。実際の売上個数を調べ…」(唐突) ○「店長に渋られたため、実際の売上個数を調べ…」/「店長に渋られました。そこで実際の売上個数を調べ…」",
      "・同じ接続詞の近接重複はなるべく避ける(下記バンクから類語へ置換)。ただし置換がぎこちないときは、接続詞を消して文を組み替える方を優先してよい。重複回避より自然さが上位。",
      "・接続詞は一文ごとに必ず付ける必要はない。多用や不自然な反復は、かえって文章を硬く・くどくする点に注意する。",
      "・接続詞バンク:[課題を受けて]そこで/そのため [逆接]しかし/ただ/もっとも/とはいえ [障害を受けて再行動]そこで/そうして/それならばと/そこで改めて [追加・並列]さらに/加えて/あわせて [因果・帰結]その結果/結果/こうして [まとめ]この経験から/以上から",
      "",
      "【セルフチェック(本文を出す前に全項目を満たすこと)】",
      "①字数(95〜100%・数えて明記)  ②ですます調・用語統一  ③事実のみ(創作なし)",
      "④文のつながりが自然で能動的(特に障害→行動が唐突でない)。接続詞の近接重複はなるべく避ける。ただし機械的に足したり置換して不自然になっていないか(自然さが最優先)",
      "⑤締めが前段から導ける",
      "⑥マイナスの言い切りがない(挫折は前向きな判断へ変換)",
      "⑦中心語の近接重複がない(用語統一の固定語は除く)",
      "⑧音読して、文の切れ目が\"ブツ切れ\"でないか確認(つなぎを省いた箇所がないか)",
      "⑨エピソードの時期制約を守り、設問間で主役エピソードが重複していない(再利用時は課題・行動・学びの角度を変えた)",
      "⑩固定した軸(コース/テーマ・伸ばす力・締めの強み)に沿っている(指定があれば最優先で反映)"
    ].filter(Boolean).join("\n");
  }
  function outputFormatText(){
    const multi = getQuestions().length > 1;
    const lines = [];
    let n = 1;
    if(multi) lines.push(`${n++}. 「エピソード割り当て表」:設問ごとに 使用エピソード+選んだ理由(各1行)`);
    lines.push(`${n++}. 「リサーチで分かった会社の核」:3〜5項目を箇条書きにし、各項目の末尾に出典URLを必ず併記する(例:中計名「○○」 — https://...)。URLで裏取りできない項目は「未確認」と明記し、本文では断定しない(志望動機系の設問がある場合)`);
    lines.push(`${n++}. 各設問の回答本文:【設問1】【設問2】…の順。各設問とも指定字数の95〜100%、ですます調、末尾に実字数を明記`);
    if(multi) lines.push(`${n++}. 「一貫性チェック」:エピソード重複なし/人物像の軸が一本 を各1行で自己点検`);
    lines.push(`${n++}. 「使った固有名詞リスト」`);
    return lines.join("\n");
  }
  function targetLabel(){
    const qs = getQuestions();
    if(!qs.length) return "—";
    return qs.map((q,i)=>`Q${i+1}:${q.chars}字`).join(" / ");
  }

  function buildFullPrompt(){
    const {c, kindStr} = companyLabel();
    const r = researchBlock();
    const multi = getQuestions().length > 1;
    return `あなたは日本の新卒採用に精通したES添削のプロフェッショナルです。
以下の条件で、人事担当者に「この学生はうちを本気で研究してきた」と感じさせるES回答を、全設問まとめて作成してください。
本文を書く前に、必ず最新のWeb情報(IR・統合報告書・決算説明会資料・直近1年のプレスリリース)を調べてください。
■ 応募種別: ${kindStr}
■ 応募先企業: ${c}(業界: ${val("industry")})
■ トーン: ${val("tone")}
${hasProgram()? "\n■ 応募先プログラムの内容(志望動機に必ず反映):\n"+programBlock()+"\n" : ""}■ 設問一覧(全${getQuestions().length}問):
${questionListBlock()||"【設問1】当社を志望する理由を教えてください\n・字数: 400字の95〜100%"}
■ 私(応募者)のベース情報
- 学年・学部: ${val("grade")||"未記入"}
- 活かせる経験・スキル: ${val("skills")||"なし"}
■ エピソード集(設問ごとに最適なものを割り当てて使う):
${episodesBlock()}
${finishedBlock()}
${val("selfHistory")? "\n■ 自己分析・自分史(背景資料):\nエピソード選定・自分軸の言語化・設問間の一貫性の土台として参照する。本文に丸写しせず、ここから一貫した人物像と価値観を読み取って各回答に反映する。\n"+val("selfHistory") : ""}
${(val("axisState")||val("axisStrength"))? "\n■ 固定した軸(最優先で従う):\n"+[val("axisState")?"・伸ばしたい力/なりたい状態: "+val("axisState"):"", val("axisStrength")?"・締めで寄せたい強み(全設問の締めの方向): "+val("axisStrength"):""].filter(Boolean).join("\n") : ""}
${r? "\n■ 私が把握している会社情報(参考・要ファクトチェック):\n"+r : ""}
${isIntern()? "\n■ インターン深掘り回答:\n"+(internAnswers()||"(未記入。必要なら質問してください)") : ""}
${val("extra")? "\n■ 追加要望: "+val("extra") : ""}
■ 必ず守ること
${crossRules()}
【1】会社研究:本文を書く前に、必ず最新Web情報を実際に調べる(調査自体は必須)。ただし調べた内容は全項目を無理に盛り込まず、志望動機に活きる材料だけを参考として取捨選択して使う。
- 調べる対象:最新IR/統合報告書/決算資料の「中期経営計画」と注力・成長領域、主力事業・代表サービスの具体名、同業他社2社と比べた独自の強み・差別化、企業理念/パーパスの正確な文言、直近1年のニュース(新規事業/M&A/提携)
- 反映の方針:上記のうち志望動機に効くものを選んで使う(全項目の網羅は不要)。活きる材料がなければ無理に入れない。
- 最低ライン:中期経営計画名・注力領域・主力事業名などのうち、最低1つの固有名詞は志望動機に必ず入れる(固有名詞ゼロは不可)。
- 裏取り:調べていない事実・数字は創作しない。URLで確認できない情報は本文で断定しない。
${programReflectionRules()}
【2】構成テンプレ(各設問の「構成タイプ」に従って使い分ける):
${structureTemplates()}
${isIntern()? "\n※志望動機系は「入社理由」でなく「この期間で何を学び・どう成長するか」を主役に。ただし“成長したい”で止めず何を/なぜ/どう活かすまで書く。" : ""}
${consistencyRules()}
${rulesText()}
【出力フォーマット】
${outputFormatText()}
※本文を出す前に、より良い出力のために私に聞きたいことを3つに絞って質問してください。
 ・3問を一度にまとめて提示してください(Q1・Q2・Q3)。1問ずつ私の回答を待たず、私が「1つ目→2つ目→3つ目」と続けて答えられる流れにすること。
 ・各質問には選択肢を付けてください(例:A/B/C+「その他(自由記述)」)。
 ・私が3問すべてに答えてから、本文を出力してください。${multi? "\n※複数設問なので、質問のうち1つは「エピソードの割り当て案はこれで良いか」の確認にすること(割り当て案を提示して選ばせる)。" : ""}${hasProgram()? "\n※「応募先プログラムの内容」があるので、質問のうち1つは『どのトラック/テーマに応募するか(=志望動機をどのプログラムに寄せるか)』の確認にすること。" : ""}${isIntern()? "\n※インターンなので質問に必ず次のどれかを含める:『どんな状態になりたい?』『今足りない力は?』『なぜ他社でなくここ?』" : ""}${pastedBlock()}`;
  }
  // 移植で足したもの: Coworkのエピソード集に入っていた書き上げ済みES(ESタブの「共通(完成版)」)
  function finishedBlock(){
    const xs = (plus.es || []).filter(a => a.status === "完成版" && a.answer);
    if(!xs.length) return "";
    return "\n■ 書き上げ済みのES(手本。事実・用語統一・言い回しをそろえるために参照する。そのまま流用せず、各設問と字数に合わせて書き直す):\n" +
      xs.map(a => `・${a.question}(${plusCount(a.answer)}字): ${a.answer}`).join("\n");
  }
  // 移植で足したもの: 簡易読み取りの取りこぼし対策に、貼った原文をそのまま添える
  function pastedBlock(){
    const src = val("pasteSrc");
    if(!src) return "";
    return `\n\n■ 参考:貼り付けたESページの原文(設問・字数の確認用。上の設問一覧と食い違えば原文を優先し、その旨を最初に伝える):\n"""${src.slice(0, 6000)}"""`;
  }

  // =====================================================
  // STEP0: ページを貼り付け → 簡易読み取り(正規表現)
  // =====================================================
  function regexExtract(s){
    const out = {company:"",industry:"",kind:"",internType:"",questions:[]};
    const toHalf = t => t.replace(/[０-９]/g, d=>"0123456789"["０１２３４５６７８９".indexOf(d)]);
    const co = s.match(/(?:株式会社|合同会社)\s*[^\s、。\n(（]{1,20}|[^\s、。\n(（]{1,20}\s*株式会社/);
    if(co) out.company = co[0].trim();
    if(/インターン|internship|就業体験/i.test(s)) out.kind = "インターン";
    else if(/1\s*day|1日|仕事体験/i.test(s)) out.kind = "1day仕事体験";
    const lines = s.split(/\n+/);
    const qKey = /志望|ガクチカ|学生時代|力を入れ|強み|自己\s*PR|困難|挑戦|頑張った|理由|経験/;
    const qEnd = /(?:ください|下さい|何ですか|教えて|お書き|ご記入|述べ)/;
    const seen = new Set();
    for(const line of lines){
      const t = line.trim();
      if(t.length < 8 || t.length > 200) continue;
      if(!(qKey.test(t) && qEnd.test(t))) continue;
      const key = t.slice(0,30);
      if(seen.has(key)) continue;
      seen.add(key);
      const cm = t.match(/([0-9０-９]{2,4})\s*字(?:以内|程度|前後)?/);
      out.questions.push({ question: t.replace(/\s*[（(]?\s*[0-9０-９]{2,4}\s*字(?:以内|程度|前後)?\s*[）)]?\s*/,"").trim() || t, chars: cm ? toHalf(cm[1]) : "" });
      if(out.questions.length >= 6) break;
    }
    if(!out.questions.length){
      const cm = s.match(/([0-9０-９]{2,4})\s*字(?:以内|程度|前後)?/);
      if(cm) out.questions.push({question:"", chars: toHalf(cm[1])});
    }
    return out;
  }
  function parsePage(){
    const src = val("pasteSrc");
    const prog = val("pasteProg");
    if(!src && !prog){ showToast("先にページのテキストを貼り付けてください"); return; }
    const parsed = regexExtract(src || prog);
    if(prog) parsed.programContent = prog;
    applyParsed(parsed);
    const n = (parsed.questions||[]).filter(q=>q.question).length;
    $("parseResult").textContent = (n || parsed.company || prog)
      ? `簡易判別で反映しました(設問${n}問${prog ? "/プログラム詳細はSTEP 2.5へ" : ""})。拾いもれがあれば手で直してください。貼った原文はClaudeにも渡すので、細かいずれはClaudeが直します。`
      : "⚠ 拾えるものがありませんでした。下のフォームに手で入れてください。";
    saveDraft();
  }
  function applyParsed(p){
    if(!p) return;
    if(p.company){ $("company").value = p.company; onCompany(); }
    if(p.industry && INDUSTRIES.includes(p.industry)) $("industry").value = p.industry;
    if(p.kind && KINDS.includes(p.kind)){
      const r = document.querySelector(`input[name=eb_kind][value="${p.kind}"]`);
      if(r){ r.checked = true; refreshKind(); }
    }
    if(p.internType) $("internType").value = p.internType;
    if(p.programContent) $("progContent").value = p.programContent;
    if(p.track) $("progTrack").value = p.track;
    const qs = (p.questions||[]).filter(q=>q && (q.question||q.chars));
    if(qs.length){
      clearQuestions();
      qs.forEach(q=>addQuestion(q.question||"", (q.chars && /^\d+$/.test(String(q.chars))) ? String(q.chars) : "400"));
    }
  }

  // =====================================================
  // ベース情報(自分データベース)
  // =====================================================
  function defaultGrade(pr){
    const u = (pr.education || []).find(e => /大学/.test(e.school || ""));
    if (!u) return "";
    let year = "";
    if (u.start) {
      const [y, m] = u.start.split("-").map(Number);
      const now = new Date();
      year = (now.getFullYear() - y) + (now.getMonth() + 1 >= (m || 4) ? 1 : 0);
    }
    return `${u.school}${u.faculty ? " " + u.faculty : ""}${year ? ` ${year}年` : ""}`;
  }
  function defaultSelfHistory(pr){
    const cm = pr.core_message || {};
    const out = [];
    if (cm.strength_full || cm.pr_core) out.push(`【自分とは・強み】${[cm.pr_core, cm.strength_full].filter(Boolean).join("。")}`);
    if (cm.os) out.push(`【考え方のくせ】${cm.os}`);
    if ((plus.insights || []).length) out.push(`【いまの考え(キャリア)】\n${plus.insights.map(i => `・${i.statement}`).join("\n")}`);
    if ((pr.job_axes || []).length) out.push(`【仕事選びの軸】${pr.job_axes.join(" / ")}`);
    if (cm.episode_roles) out.push(`【エピソードの役割分担】${cm.episode_roles}`);
    return out.join("\n");
  }
  function defaultSkills(pr){
    return (pr.licenses || []).filter(l => !/運転免許/.test(l.name)).map(l => l.name).join("、");
  }
  function fillBase(force){
    const pr = plus.profile;
    if (!pr || (baseFilled && !force)) return;
    const b = pr.builder || {};
    $("grade").value = b.grade || defaultGrade(pr);
    $("skills").value = b.skills != null && b.skills !== "" ? b.skills : defaultSkills(pr);
    $("selfHistory").value = b.selfHistory || defaultSelfHistory(pr);
    $("savedMark").textContent = b.updated_at ? "✓ 保存済み" : "(自分データベースから自動で入れました。直したら保存)";
    baseFilled = true;
  }
  function renderEpisodes(){
    const eps = getEpisodes();
    $("epList").innerHTML = eps.length ? eps.map((e, i) => `
      <details class="eb-ep"><summary><b>エピソード${i + 1}</b> ${escapeHtml(e.label)} <span class="eb-tag">${escapeHtml(e.period)}</span></summary>
        <div class="eb-ep-body"><div class="eb-hint">強み:${escapeHtml(e.strength)}</div>${escapeHtml(e.text)}</div></details>`).join("")
      : `<div class="eb-hint">${plusReady ? "まだありません" : "読み込み中…"}</div>`;
    refreshEpSelects();
  }
  async function saveBase(){
    try {
      const r = await plusApi("save_builder", { grade: val("grade"), skills: val("skills"), selfHistory: val("selfHistory") });
      if (plus.profile) plus.profile.builder = r;
      $("savedMark").textContent = "✓ 保存済み";
      showToast("ベース情報を保存しました");
    } catch (e) { showToast("保存できませんでした: " + e.message); }
  }

  // =====================================================
  // 応募ごとの入力は下書きとして端末に残す(閉じても消えない)
  // =====================================================
  const DRAFT_FIELDS = ["pasteSrc","pasteProg","internType","company","industry","tone","progContent","progTrack","axisState","axisStrength","extra"];
  function saveDraft(){
    if (!$("company")) return;
    const d = { kind: getKind(), ctx, questions: [...document.querySelectorAll("#eb_qList .eb-qrow")].map(r => ({
      text: r.querySelector(".q-text").value, chars: r.querySelector(".q-chars").value, ep: r.querySelector(".q-ep").value,
      close: r.querySelector(".q-close").value, esId: r.dataset.esId || "" })) };
    DRAFT_FIELDS.forEach(f => d[f] = $(f).value);
    plusStore.set(DRAFT_KEY, JSON.stringify(d));
  }
  function loadDraft(){
    let d = null;
    try { d = JSON.parse(plusStore.get(DRAFT_KEY) || "null"); } catch {}
    if (!d) { addQuestion(); return; }
    DRAFT_FIELDS.forEach(f => { if (d[f] != null) $(f).value = d[f]; });
    const r = document.querySelector(`input[name=eb_kind][value="${d.kind}"]`); if (r) r.checked = true;
    ctx = d.ctx || ctx;
    (d.questions || []).forEach(q => addQuestion(q.text, q.chars, q.ep, q.esId, q.close || "auto"));
    if (!(d.questions || []).length) addQuestion();
  }
  function resetForm(){
    if (!confirm("この応募の入力(会社・設問・プログラム・軸)を空にしますか?ベース情報は残ります。")) return;
    DRAFT_FIELDS.forEach(f => { $(f).value = f === "industry" ? "その他" : f === "tone" ? "誠実・丁寧" : ""; });
    document.querySelector('input[name=eb_kind][value="本選考"]').checked = true;
    ctx = { entry_id: "", program: "" };
    clearQuestions(); addQuestion(); refreshKind();
    $("parseResult").textContent = ""; $("outCard").style.display = "none";
    plusStore.set(DRAFT_KEY, "");
  }
  function onCompany(){
    const e = plusEntryForCompany(val("company"));
    $("companyHint").textContent = e ? `✓ 選考管理の「${e.company}${e.program ? "(" + e.program + ")" : ""}」に紐づけます` : (val("company") ? "選考管理に無い会社です(保存すると社名で紐づけます)" : "");
    if (e && ctx.entry_id !== e.id) ctx = { entry_id: e.id, program: e.program || "" };
    if (!e) ctx = { entry_id: "", program: "" };
  }

  // =====================================================
  // Claudeへ
  // =====================================================
  function validate(){
    if(!val("company")){ showToast("会社名を入力してください"); return false; }
    if(!getQuestions().length){ showToast("設問を1つ以上入力してください"); return false; }
    return true;
  }
  async function askClaude(){
    if (!validate()) return;
    const btn = $("askBtn"); btn.disabled = true;
    try {
      const company = val("company");
      const ent = plusEntryForCompany(company);
      const entryId = ctx.entry_id || (ent ? ent.id : "");
      const program = val("progTrack") || val("internType") || ctx.program || "";
      const qs = getQuestions();
      const rows = [...document.querySelectorAll("#eb_qList .eb-qrow")].filter(r => r.querySelector(".q-text").value.trim());
      const ids = [];
      for (let i = 0; i < qs.length; i++) {
        const q = qs[i];
        const args = { company, entry_id: entryId, program, question: q.text, char_limit: String(q.chars || "") };
        if (q.esId) args.id = q.esId; else args.status = "書いてもらい中";
        const saved = await plusApi("save_es", args);
        ids.push(saved.id);
        rows[i].dataset.esId = saved.id;
      }
      const prompt = buildFullPrompt();
      const builder = JSON.parse(plusStore.get(DRAFT_KEY) || "{}");
      const r = await plusApi("request_es", { company, entry_id: entryId, program, es_ids: ids,
        questions: qs.map(q => ({ q: q.text, limit: q.chars })), prompt, builder });
      saveDraft();
      const msg = `就活アプリのES書いて(待ち#${r.queue_id} ${company} ${ids.length}問)`;
      await copyToClipboard(msg);
      showToast("Claudeの待ちに入れました。開いたClaudeでそのまま送信してください");
      window.open("https://claude.ai/new?q=" + encodeURIComponent(msg), "_blank");
      plusLoad(true);
    } catch (e) { showToast("できませんでした: " + e.message); }
    finally { btn.disabled = false; }
  }
  function copyFullPrompt(){
    if (!validate()) return;
    const p = buildFullPrompt();
    copyToClipboard(p);
    showOutput("本格生成プロンプト(このままClaudeのチャットへ貼り付け)", p);
    showToast("コピーしました!Claudeのチャットに貼り付けて送信");
  }
  function showOutput(title, text){
    $("outCard").style.display = "block";
    $("outTitle").textContent = title;
    $("output").value = text;
    lastOutput = text;
    $("target").textContent = targetLabel();
    recount();
    $("outCard").scrollIntoView({behavior:"smooth", block:"start"});
  }
  function recount(){ $("cnt").textContent = ($("output").value||"").replace(/\s/g,"").length; }

  // =====================================================
  // 画面
  // =====================================================
  function html(){
    return `
<div class="eb-guide"><b>使い方:</b> ①ESページを貼って「読み取る」→ 設問がリストになる。②ベース情報は自分データベースから自動で入る。③「Claudeに書いてもらう」でClaudeが会社を調べて全設問を書き、このアプリのESに保存します。</div>
<div class="eb-card">
  <h3><span class="eb-badge">STEP 0</span> ページを貼り付け <span class="eb-hint">(任意・自動入力)</span></h3>
  <label>① ESページ(設問) <span class="eb-hint">(志望動機・ガクチカなどの設問画面)</span></label>
  <textarea id="eb_pasteSrc" style="min-height:90px" placeholder="ここにES設問ページのテキストを貼り付け(Ctrl+Aで全選択→コピー)"></textarea>
  <label>② インターン/プログラムのページ <span class="eb-hint">(任意。内容・日数・テーマ・募集メッセージなど)</span></label>
  <textarea id="eb_pasteProg" style="min-height:90px" placeholder="ここにインターン/プログラム募集ページのテキストを貼り付け(任意)"></textarea>
  <div class="eb-btns">
    <button type="button" id="eb_parseBtn">🪄 自動で読み取る</button>
    <button type="button" class="secondary" id="eb_pasteClear">クリア</button>
  </div>
  <p class="eb-hint" id="eb_parseResult"></p>
</div>
<div class="eb-card">
  <h3><span class="eb-badge">STEP 1</span> 応募種別</h3>
  <div class="eb-seg">
    <label><input type="radio" name="eb_kind" value="本選考" checked><span>本選考</span></label>
    <label><input type="radio" name="eb_kind" value="インターン"><span>インターン</span></label>
    <label><input type="radio" name="eb_kind" value="1day仕事体験"><span>1day仕事体験</span></label>
  </div>
  <div class="eb-intern-only" id="eb_internKind">
    <label>インターンの種別 <span class="eb-hint">(例:サマー / 3days / ウィンター)</span></label>
    <input type="text" id="eb_internType" placeholder="例:サマーインターン(5days)">
  </div>
  <p class="eb-hint" id="eb_kindHint"></p>
</div>
<div class="eb-card">
  <h3><span class="eb-badge">STEP 2</span> 応募先企業と設問リスト</h3>
  <div class="eb-row">
    <div>
      <label>会社名</label>
      <input type="text" id="eb_company" list="eb_companyList" placeholder="例:三菱商事">
      <datalist id="eb_companyList"></datalist>
      <div class="eb-hint" id="eb_companyHint"></div>
    </div>
    <div>
      <label>業界</label>
      <select id="eb_industry">${INDUSTRIES.map(i => `<option>${i}</option>`).join("")}</select>
    </div>
  </div>
  <label>設問 <span class="eb-hint">(複数OK。設問ごとに構成タイプを自動判定します)</span></label>
  <div id="eb_qList"></div>
  <div class="eb-btns"><button type="button" class="secondary" id="eb_addQ">➕ 設問を追加</button></div>
  <label>トーン</label>
  <select id="eb_tone"><option>誠実・丁寧</option><option>ロジカル・論理的</option><option>熱意とストーリー重視</option></select>
</div>
<div class="eb-card">
  <h3><span class="eb-badge">STEP 2.5</span> 応募先プログラムの内容 <span class="eb-hint">(任意)</span></h3>
  <div class="eb-hint">募集ページの文字起こしをそのまま貼ると、志望動機系の設問に反映します。<b>複数プログラムがある場合は「応募トラック」を必ず明記</b>。</div>
  <label>プログラム内容</label>
  <textarea id="eb_progContent" style="min-height:100px" placeholder="例)
- プログラム名:◯◯ビジネスワークショップ
- 日数 / 形式:2days / 対面(東京本社)
- テーマ・内容:新規事業の戦略立案ワーク
- キャッチコピー / 募集メッセージ:「答えのない問いに、挑む。」
- 「こんな方におすすめ」:課題解決が好きな方 / 当事者意識を持って動ける方"></textarea>
  <label>応募トラック <span class="eb-hint">(複数プログラム/コースがある場合、どれに出すか)</span></label>
  <input type="text" id="eb_progTrack" placeholder="例:2days戦略立案コース">
</div>
<div class="eb-card">
  <h3><span class="eb-badge">STEP 2.6</span> 軸の固定 <span class="eb-hint">(任意・ぶれ防止)</span></h3>
  <div class="eb-hint">空欄なら、Claudeが本文を書く前にまとめて1回だけ質問します。</div>
  <label>伸ばしたい力 / なりたい状態の軸 <span class="eb-hint">(インターン志望動機の主役)</span></label>
  <input type="text" id="eb_axisState" placeholder="例:定量分析を事業判断に結びつける力を伸ばしたい">
  <label>締めで寄せたい強み <span class="eb-hint">(全設問の締めの方向を揃える)</span></label>
  <input type="text" id="eb_axisStrength" placeholder="例:課題解決力">
</div>
<div class="eb-card">
  <h3><span class="eb-badge">STEP 3</span> あなたのベース情報 <span class="eb-saved" id="eb_savedMark"></span></h3>
  <label>学年・学部</label>
  <input type="text" id="eb_grade">
  <label>エピソード集 <span class="eb-hint">(自分データベースのエピソード。直したいときはClaudeに「〇〇のエピソード、ここ違う」)</span></label>
  <div id="eb_epList"></div>
  <label>自己分析・自分史メモ <span class="eb-hint">(自分とは/価値観/キャリアプラン/経験の流れ。背景資料として渡します)</span></label>
  <textarea id="eb_selfHistory" style="min-height:140px"></textarea>
  <label>その会社で活かせそうな経験・スキル <span class="eb-hint">(なければ空欄でOK)</span></label>
  <textarea id="eb_skills"></textarea>
  <div class="eb-btns">
    <button type="button" class="secondary" id="eb_saveBase">💾 ベース情報を保存</button>
    <button type="button" class="secondary" id="eb_resetBase">データベースから入れ直す</button>
  </div>
</div>
<div class="eb-card">
  <h3><span class="eb-badge">任意</span> 追加要望</h3>
  <textarea id="eb_extra" placeholder="例:飲食店の経験を必ず入れて/競合△△との違いに触れて(空欄でもOK)"></textarea>
</div>
<div class="eb-card">
  <div class="eb-btns">
    <button type="button" id="eb_askBtn">🤖 Claudeに書いてもらう(アプリに保存)</button>
    <button type="button" class="secondary" id="eb_copyBtn">📋 プロンプトだけコピー</button>
    <button type="button" class="secondary" id="eb_reset">この応募を空にする</button>
  </div>
  <p class="eb-hint">「Claudeに書いてもらう」:設問をESタブに入れてClaudeを開きます。Claudeが3つ質問→答える→全設問を書いて、このアプリのESに保存します。<br>「プロンプトだけコピー」:CoworkなどアプリにつながっていないClaudeで使うとき。</p>
</div>
<div class="eb-card" id="eb_outCard" style="display:none">
  <h3><span class="eb-badge">OUTPUT</span> <span id="eb_outTitle">生成結果</span></h3>
  <div class="eb-hint">文字数(空白除く全体): <b id="eb_cnt">0</b> / 目標 <span id="eb_target">—</span></div>
  <textarea id="eb_output" spellcheck="false" style="min-height:240px"></textarea>
  <div class="eb-btns">
    <button type="button" class="secondary" id="eb_copyOut">📋 編集後の内容をコピー</button>
    <button type="button" class="secondary" id="eb_revert">↩ 生成直後に戻す</button>
  </div>
</div>`;
  }
  function css(){
    return `
    #ebView { margin-top: 10px; }
    .eb-guide { font-size: 12px; color: #5b6470; background: #fff8ec; border: 1px solid #f3e3c0; border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; line-height: 1.7; }
    .eb-guide b { color: #8a6d2f; }
    .eb-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px; margin-bottom: 12px; box-shadow: var(--shadow); }
    .eb-card h3 { font-size: 14px; margin: 0 0 8px; padding-bottom: 8px; border-bottom: 1px solid #eef0f3; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .eb-card label { display: block; font-size: 12px; font-weight: 600; color: #444c57; margin: 10px 0 4px; }
    .eb-card input[type=text], .eb-card input[type=number], .eb-card select, .eb-card textarea { width: 100%; }
    .eb-badge { background: #eef2ff; color: #4356c7; font-size: 11px; border-radius: 6px; padding: 2px 7px; font-weight: 700; }
    .eb-hint { font-size: 11.5px; color: var(--muted); font-weight: 400; line-height: 1.6; }
    .eb-saved { font-size: 11px; color: var(--success); font-weight: 600; }
    .eb-row { display: flex; gap: 10px; flex-wrap: wrap; }
    .eb-row > div { flex: 1; min-width: 160px; }
    .eb-btns { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
    .eb-seg { display: flex; gap: 6px; flex-wrap: wrap; }
    .eb-seg label { margin: 0; flex: 1; min-width: 90px; cursor: pointer; border: 1px solid var(--border); border-radius: 8px; padding: 9px 6px; text-align: center; font-size: 12.5px; background: #fff; }
    .eb-seg input { display: none; }
    .eb-seg label:has(input:checked) { background: var(--primary); border-color: var(--primary); color: #fff; }
    .eb-intern-only { display: none; }
    .eb-intern-only.show { display: block; }
    .eb-qrow { border: 1px dashed #c9cfd8; border-radius: 10px; padding: 10px; margin-bottom: 8px; background: #fbfcfe; }
    .eb-qhead { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .eb-qnum { font-size: 12px; font-weight: 700; color: #4356c7; }
    .eb-qtype { font-size: 11px; background: #eef2ff; color: #4356c7; border-radius: 6px; padding: 1px 8px; }
    .eb-qtype.exp { background: #eafaf0; color: #1f7a46; }
    .eb-qdel { margin-left: auto; background: none; border: none; color: #9aa2ad; font-size: 15px; padding: 2px 6px; cursor: pointer; }
    .eb-qrow label { margin-top: 0; }
    .eb-ep { border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; margin-bottom: 6px; background: #fff; font-size: 13px; }
    .eb-ep summary { cursor: pointer; }
    .eb-ep-body { font-size: 12px; color: #374151; line-height: 1.7; margin-top: 6px; white-space: pre-wrap; }
    .eb-tag { font-size: 11px; background: #f3f4f6; border-radius: 6px; padding: 1px 6px; color: var(--muted); }
    `;
  }

  let installed = false;
  function install(){
    if (installed) return;
    const host = document.getElementById("ebView");
    if (!host) return;
    installed = true;
    const st = document.createElement("style"); st.textContent = css(); document.head.appendChild(st);
    host.innerHTML = html();
    document.querySelectorAll('input[name=eb_kind]').forEach(r => r.addEventListener("change", () => { refreshKind(); saveDraft(); }));
    $("parseBtn").onclick = parsePage;
    $("pasteClear").onclick = () => { $("pasteSrc").value = ""; $("pasteProg").value = ""; saveDraft(); };
    $("addQ").onclick = () => { addQuestion(); saveDraft(); };
    $("saveBase").onclick = saveBase;
    $("resetBase").onclick = () => {
      if (!plus.profile) return;
      if (!confirm("学年・自己分析・スキルを自分データベースの内容で入れ直しますか?(保存するまで反映されません)")) return;
      const pr = plus.profile;
      $("grade").value = defaultGrade(pr); $("skills").value = defaultSkills(pr); $("selfHistory").value = defaultSelfHistory(pr);
      $("savedMark").textContent = "(未保存)";
    };
    $("askBtn").onclick = askClaude;
    $("copyBtn").onclick = copyFullPrompt;
    $("reset").onclick = resetForm;
    $("output").addEventListener("input", recount);
    $("copyOut").onclick = () => { copyToClipboard($("output").value); showToast("編集後の内容をコピーしました"); };
    $("revert").onclick = () => { $("output").value = lastOutput; recount(); showToast("生成直後の内容に戻しました"); };
    $("company").addEventListener("change", onCompany);
    host.addEventListener("input", ev => { if (!ev.target.closest("#eb_grade,#eb_selfHistory,#eb_skills,#eb_output")) saveDraft(); });
    host.addEventListener("change", ev => { if (ev.target.matches(".q-ep,select")) saveDraft(); });
    ["grade", "selfHistory", "skills"].forEach(f => $(f).addEventListener("input", () => { $("savedMark").textContent = "(未保存)"; baseFilled = true; }));
    loadDraft();
    refreshKind();
  }
  // plus のデータが変わるたびに呼ばれる
  function sync(){
    install();
    if (!installed) return;
    $("companyList").innerHTML = [...new Set(entries.map(e => e.company).filter(Boolean))].map(c => `<option value="${escapeHtml(c)}">`).join("");
    renderEpisodes();
    fillBase(false);
    if (val("company")) onCompany();
  }
  // 会社画面・ESの編集画面から開く
  function openWith(o){
    install();
    if (getQuestions().length && val("company") && plusNorm(val("company")) !== plusNorm(o.company)) {
      if (!confirm(`ビルダーには「${val("company")}」の入力が残っています。${o.company}の内容に入れ替えますか?`)) { showBuilder(); return; }
    }
    $("company").value = o.company || "";
    ctx = { entry_id: o.entry_id || "", program: o.program || "" };
    if (o.program && !val("internType")) $("internType").value = o.program;
    if (/インターン|days|day/i.test(o.program || "")) {
      const r = document.querySelector('input[name=eb_kind][value="インターン"]'); if (r) { r.checked = true; refreshKind(); }
    }
    if ((o.questions || []).length) {
      clearQuestions();
      o.questions.forEach(q => addQuestion(q.text || "", String(q.chars || 400), "auto", q.esId || ""));
    }
    onCompany();
    saveDraft();
    showBuilder();
  }
  function showBuilder(){
    closeModal();
    const m = document.getElementById("plusEsModal"); if (m) m.classList.remove("open");
    currentTab = "es"; plusEsView = "builder"; renderAll();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  return { sync, openWith, install };
})();
