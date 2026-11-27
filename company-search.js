// 企業名のあいまい検索
// 大文字小文字・全角半角・ひらがな/カタカナ・漢字の読み・ローマ字・略称・1文字の打ち間違いを吸収する。
// 新しい会社で読みが当たらないときは、会社の編集画面の「よみ・別の呼び方」に足すと検索に入る。
const companySearch = (function () {
  // 言葉の読み(会社名の中に出てくる漢字・英字のまとまり → ひらがな。"|" で複数)
  const WORDS = {
    "富士通": "ふじつう", "富士": "ふじ", "日鉄": "にってつ", "日立": "ひたち", "日清": "にっしん", "日本": "にほん|にっぽん",
    "日本生命": "にほんせいめい|にっせい", "日本総研": "にほんそうけん|にほんそうごうけんきゅうしょ|にっそうけん",
    "日本政策投資銀行": "にほんせいさくとうしぎんこう|せいとうぎん|dbj", "日本政策金融公庫": "にほんせいさくきんゆうこうこ|こっきん|jfc",
    "政策": "せいさく", "投資": "とうし", "金融": "きんゆう", "公庫": "こうこ", "銀行": "ぎんこう|ばんく", "信用金庫": "しんようきんこ|しんきん", "信託": "しんたく",
    "三井住友": "みついすみとも", "三井": "みつい", "住友": "すみとも", "三菱": "みつびし", "伊藤忠": "いとうちゅう", "古河": "ふるかわ",
    "楽天": "らくてん", "花王": "かおう", "東京": "とうきょう", "海上": "かいじょう", "日動": "にちどう", "東急": "とうきゅう",
    "電通総研": "でんつうそうけん", "電通": "でんつう", "総研": "そうけん", "内田洋行": "うちだようこう", "内田": "うちだ", "洋行": "ようこう",
    "村田製作所": "むらたせいさくしょ|むらた", "村田": "むらた", "製作所": "せいさくしょ", "大塚商会": "おおつかしょうかい", "大塚": "おおつか", "商会": "しょうかい",
    "大同": "だいどう", "大和": "だいわ|やまと", "生命": "せいめい", "保険": "ほけん", "損害保険": "そんがいほけん|そんぽ", "損害": "そんがい",
    "相互会社": "そうごがいしゃ", "共同事業体": "きょうどうじぎょうたい", "採用": "さいよう",
    "明治安田": "めいじやすだ", "明治": "めいじ", "安田": "やすだ", "能美防災": "のうみぼうさい|のうみ", "能美": "のうみ", "防災": "ぼうさい",
    "農林中央金庫": "のうりんちゅうおうきんこ|のうりんちゅうきん|のうちゅう", "農林": "のうりん", "中央": "ちゅうおう", "金庫": "きんこ",
    "野村": "のむら", "研究所": "けんきゅうしょ", "静岡": "しずおか", "横浜": "よこはま", "積水": "せきすい", "星野": "ほしの",
    "丸井": "まるい", "地所": "じしょ|ちしょ", "自動車": "じどうしゃ", "工業": "こうぎょう", "電気": "でんき", "電機": "でんき", "発動機": "はつどうき",
    "江崎": "えざき", "製薬": "せいやく", "食品": "しょくひん", "証券": "しょうけん", "建設": "けんせつ", "不動産": "ふどうさん",
    "鉄道": "てつどう", "旅客": "りょかく", "通信": "つうしん", "情報": "じょうほう", "技術": "ぎじゅつ", "商事": "しょうじ", "物産": "ぶっさん",
    "共通": "きょうつう", "完成版": "かんせいばん", "事務系": "じむけい",
  };
  // 会社名で漢字が1文字ずつでも当たるように(上の言葉に無い新しい会社向け)
  const KANJI = "一:いち|いっ|かず,三:さん|み|みつ,上:うえ|じょう|かみ,下:した|しも|か,中:なか|ちゅう,丸:まる,久:ひさ|きゅう,井:い,京:きょう|けい,人:じん|にん|ひと,伊:い,佐:さ,信:しん|のぶ,倉:くら|そう,元:もと|げん,光:こう|ひかり|みつ,全:ぜん,公:こう,共:きょう,具:ぐ,内:うち|ない,出:で|しゅつ,前:まえ|ぜん,力:りょく|りき|ちから,加:か,北:きた|ほく|ほっ,南:みなみ|なん,友:とも|ゆう,古:ふる|こ,合:ごう|あい,同:どう,味:あじ|み,和:わ,商:しょう,四:し|よん,国:こく|くに|こっ,地:ち|じ,城:しろ|じょう,堂:どう,塚:つか|づか,士:し,大:だい|おお|たい,天:てん,太:た|たい,央:おう,子:こ|し,学:がく|がっ,安:あん|やす,宝:たから|ほう,室:むろ|しつ,宮:みや|ぐう,家:いえ|か|や,富:ふ|とみ,寺:てら|じ,小:こ|お|しょう,山:やま|さん,岡:おか,島:しま|じま|とう,崎:さき|ざき,川:かわ|がわ|せん,工:こう,市:いち|し,平:ひら|へい|たいら,広:ひろ|こう,店:てん|みせ,建:けん|たて,式:しき,後:ご|あと,忠:ちゅう,急:きゅう,戸:と|こ,所:しょ|じょ|ところ,技:ぎ,投:とう,政:せい,文:ぶん,新:しん|あら|にい,方:ほう|かた,旭:あさひ,明:めい|あき,星:ほし|せい,映:えい,春:はる|しゅん,昭:しょう,智:ち,月:つき|げつ|がつ,朝:あさ|ちょう,木:き|ぎ|もく,本:ほん|もと,村:むら|そん,東:とう|ひがし,松:まつ|しょう,林:はやし|ばやし|りん,森:もり|しん,業:ぎょう,極:きょく,楽:らく|がく,機:き,橋:はし|ばし|きょう,正:せい|しょう|まさ,水:みず|すい,永:なが|えい,江:え|こう,沢:さわ|ざわ|たく,河:かわ|かん|か,油:ゆ|あぶら,治:じ|はる,洋:よう,浜:はま|ひん,海:かい|うみ,清:せい|しん|きよ,渡:わた,港:みなと|こう,瀬:せ,災:さい,熊:くま,片:かた,物:ぶつ|もの,王:おう,現:げん,理:り,生:せい|しょう|い,産:さん,田:た|だ|でん,由:ゆ|よし,界:かい,白:しろ|はく|しら,百:ひゃく,盛:もり|せい,相:そう|あい,石:いし|せき,研:けん,社:しゃ,神:かみ|しん|こう,福:ふく,秀:ひで|しゅう,究:きゅう,空:そら|くう,立:たつ|りつ|たち,竹:たけ|ちく,第:だい,米:こめ|べい|よね,紙:かみ|し,総:そう,織:おり|しょく,美:み|び,羽:は|はね,能:のう,興:こう,船:ふね|せん,花:はな|か,菱:ひし|びし,藤:ふじ|とう,薬:やく|くすり,行:こう|ぎょう,製:せい,西:にし|せい|さい,角:かど|かく,証:しょう,谷:たに|や|こく,豊:ゆたか|とよ|ほう,貨:か,販:はん,貿:ぼう,賃:ちん,車:くるま|しゃ,近:きん|ちか,通:つう,造:ぞう,進:しん,運:うん,道:どう|みち,郵:ゆう,都:と|みやこ,配:はい,酒:さけ|しゅ,野:の|や,金:きん|かね,鈴:すず|れい,鉄:てつ,銀:ぎん,鋼:こう,長:なが|ちょう,開:かい,阪:さか|はん,陽:よう,雪:ゆき|せつ,電:でん,震:しん,青:あお|せい,面:めん,音:おと|おん,風:かぜ|ふう,飛:ひ|とび,食:しょく,飲:いん,館:かん,香:か|こう,馬:うま|ば,高:たか|こう,鳥:とり|ちょう,鹿:か|しか,黒:くろ|こく,齋:さい,龍:りゅう"
    .split(",").reduce((m, s) => { const [k, v] = s.split(":"); m[k] = v; return m; }, {});
  // 会社ごとの別の呼び方(英字の会社をかなで、略称、旧社名など)。左の文字が会社名に含まれたら右も検索に入れる
  const ALIASES = [
    ["agc", "えーじーしー|あさひがらす|旭硝子"], ["biprogy", "びぷろじー|日本ユニシス|にほんゆにしす"], ["canon", "きやのん|きゃのん"],
    ["carta", "かるた|かーたほーるでぃんぐす"], ["daiichilife", "だいいちらいふ|第一生命|だいいちせいめい"], ["dena", "でぃーえぬえー|でな"], ["dip", "でぃっぷ"],
    ["dnp", "大日本印刷|だいにっぽんいんさつ"], ["freee", "ふりー"], ["gmo", "じーえむおー"], ["hrtech", "えいちあーるてっく"], ["jcb", "じぇーしーびー"],
    ["jcom", "じぇいこむ|じぇーこむ|jcom"], ["jr東日本", "じぇーあーるひがしにほん|jreast|東日本旅客鉄道"], ["jtb", "じぇーてぃーびー"], ["kddi", "けーでぃーでぃーあい|au"],
    ["lineヤフー", "らいんやふー|yahoo|ヤフー|line|lyc"], ["nec", "えぬいーしー|日本電気|にほんでんき"], ["nttdata", "えぬてぃてぃでーた|nttデータ"],
    ["nttデータ", "nttdata|えぬてぃてぃでーた"], ["nttドコモ", "docomo|どこも"], ["ntt東日本", "えぬてぃてぃひがしにほん"], ["ntt西日本", "えぬてぃてぃにしにほん"], ["ntt", "えぬてぃてぃ"],
    ["repro", "りぷろ"], ["sansan", "さんさん"], ["scsk", "えすしーえすけー|住商"], ["tdk", "てぃーでぃーけー"], ["tis", "てぃーあいえす"], ["toppan", "とっぱん|凸版|凸版印刷"],
    ["ucc", "ゆーしーしー|上島珈琲"], ["zozo", "ぞぞ|ぞぞたうん"], ["smarthr", "すまーとえいちあーる|すまーとhr"], ["jsol", "じぇいそる"], ["iij", "あいあいじぇい|いんたーねっといにしあてぃぶ"],
    ["jig-saw", "じぐそー|じぐそう"], ["omron", "おむろん"], ["オムロン", "omron"], ["ギフティ", "giftee"], ["ナイル", "nyle"], ["メルカリ", "mercari"], ["アンドパッド", "andpad"], ["マクロミル", "macromill"], ["ラクス", "rakus"],
    ["インテージ", "intage"], ["ネットプロテクションズ", "netprotections|ネプロ"], ["クレディセゾン", "saison|セゾン"], ["オリエントコーポレーション", "orico|オリコ"], ["ジャックス", "jaccs"],
    ["サイバーエージェント", "cyberagent|ca"], ["ソフトバンク", "softbank|sb"], ["ソニー", "sony"], ["パナソニック", "panasonic"], ["バンダイナムコ", "bandainamco|バンナム"],
    ["サントリー", "suntory"], ["アサヒ", "asahi"], ["キリン", "kirin"], ["ライオン", "lion"], ["カゴメ", "kagome"], ["コクヨ", "kokuyo"], ["クラレ", "kuraray"], ["リコー", "ricoh"], ["スズキ", "suzuki"], ["ヤマハ", "yamaha"], ["ローム", "rohm"], ["ロート", "rohto"],
    ["イオン", "aeon"], ["オリックス", "orix"], ["アビーム", "abeam"], ["デロイト", "deloitte"], ["シンプレクス", "simplex"], ["フューチャー", "future"], ["アズビル", "azbil"], ["エステー", "st"], ["コニカミノルタ", "konicaminolta|こにみの"],
    ["マネーフォ", "moneyforward|まねーふぉわーど|mf"], ["伊藤忠テクノソリューションズ", "ctc"], ["野村総合研究所", "nri|野村総研|のむらそうけん"], ["日鉄ソリューションズ", "nssol|ns-sol|新日鉄ソリューションズ"],
    ["富士フイルムビジネスイノベーション", "fujifilm|富士ゼロックス|fb|富士びじねす"], ["富士フイルム", "fujifilm|富士フィルム"], ["ドコモソリューションズ", "nttコムウェア|こむうぇあ"],
    ["三菱ufj", "mufg|ゆーえふじぇい"], ["三井住友", "smbc|smcc"], ["三菱hcキャピタル", "mhc"], ["三井住友海上あいおい", "msad|あいおいにっせい"], ["東京海上", "tokiomarine|とうきょうかいじょう"], ["損害保険ジャパン", "損保ジャパン|そんぽじゃぱん|sompo"],
    ["日清食品", "nissin"], ["古河電気", "古河電工|ふるかわでんこう"], ["江崎グリコ", "glico|ぐりこ"], ["花王", "kao"], ["楽天", "rakuten"], ["静岡銀行", "しずぎん"], ["りそな", "resona"], ["みずほ", "mizuho"], ["j&j", "じぇいあんどじぇい"],
  ];

  const LEGAL = /株式会社|有限会社|合同会社|相互会社|\(株\)/g;
  const SMALL = { "ぁ": "あ", "ぃ": "い", "ぅ": "う", "ぇ": "え", "ぉ": "お", "っ": "つ", "ゃ": "や", "ゅ": "ゆ", "ょ": "よ", "ゎ": "わ" };
  // 表記ゆれをそろえる:全角半角・大文字小文字・カタカナ→ひらがな・小さい字・長音・記号
  function norm(s) {
    return String(s || "").normalize("NFKC").toLowerCase().replace(LEGAL, "")
      .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/ゔぁ/g, "ば").replace(/ゔぃ/g, "び").replace(/ゔぇ/g, "べ").replace(/ゔぉ/g, "ぼ").replace(/ゔ/g, "ぶ")
      .replace(/[ぁぃぅぇぉっゃゅょゎ]/g, c => SMALL[c])
      .replace(/ぢ/g, "じ").replace(/づ/g, "ず").replace(/を/g, "お").replace(/ゐ/g, "い").replace(/ゑ/g, "え")
      .replace(/[\s・･.,、。'’"“”()\[\]【】「」『』{}<>_\/\\|:;!?*+=~〜～ー‐‑‒–—―−-]/g, "")
      .replace(/ヶ/g, "け");
  }

  const ROMA = (function () {
    const m = {};
    const rows = { "": "あいうえお", k: "かきくけこ", s: "さしすせそ", t: "たちつてと", n: "なにぬねの", h: "はひふへほ", m: "まみむめも", r: "らりるれろ", l: "らりるれろ",
      g: "がぎぐげご", z: "ざじずぜぞ", d: "だじずでど", b: "ばびぶべぼ", p: "ぱぴぷぺぽ" };
    Object.entries(rows).forEach(([c, k]) => "aiueo".split("").forEach((v, i) => { m[c + v] = k[i]; }));
    const y = { k: "き", s: "し", t: "ち", n: "に", h: "ひ", m: "み", r: "り", g: "ぎ", z: "じ", j: "じ", d: "じ", b: "び", p: "ぴ" };
    Object.entries(y).forEach(([c, k]) => { m[c + "ya"] = k + "や"; m[c + "yu"] = k + "ゆ"; m[c + "yo"] = k + "よ"; });
    Object.assign(m, { ya: "や", yu: "ゆ", yo: "よ", wa: "わ", wo: "お", shi: "し", chi: "ち", tsu: "つ", fu: "ふ", ji: "じ",
      sha: "しや", shu: "しゆ", sho: "しよ", she: "しえ", cha: "ちや", chu: "ちゆ", cho: "ちよ", che: "ちえ", ja: "じや", ju: "じゆ", jo: "じよ", je: "じえ",
      fa: "ふあ", fi: "ふい", fe: "ふえ", fo: "ふお", va: "ば", vi: "び", vu: "ぶ", ve: "べ", vo: "ぼ", thi: "てい", dhi: "でい" });
    return m;
  })();
  // ローマ字(rakuten, fujifuirumu)をひらがなに。全部読めたときだけ返す
  function romaToKana(s) {
    let out = "", i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === "n" && !/[aiueoy]/.test(s[i + 1] || "")) { out += "ん"; i += s[i + 1] === "n" && !/[aiueoy]/.test(s[i + 2] || "") ? 2 : 1; continue; }
      if (c === s[i + 1] && /[bcdfghjkmpqrstvwz]/.test(c)) { out += "つ"; i++; continue; }
      let hit = 0;
      for (const len of [3, 2, 1]) { const k = ROMA[s.substr(i, len)]; if (k && i + len <= s.length) { out += k; i += len; hit = 1; break; } }
      if (!hit) return "";
    }
    return out;
  }

  const DICT = (function () {
    const m = new Map();
    const add = (k, v) => { const nk = norm(k); if (!nk) return; const arr = m.get(nk) || []; v.split("|").forEach(x => { const r = norm(x); if (r && !arr.includes(r)) arr.push(r); }); m.set(nk, arr); };
    Object.entries(WORDS).forEach(([k, v]) => add(k, v));
    Object.entries(KANJI).forEach(([k, v]) => add(k, v));
    return m;
  })();
  const MAXKEY = Math.max(...Array.from(DICT.keys(), k => k.length));
  const ALIAS_N = ALIASES.map(([k, v]) => [norm(k), v.split("|").map(norm)]);

  // 会社名(の一部)を、そのままの字でも読みでも辿りながら q と突き合わせる
  function matchReading(name, q) {
    const memo = new Set();
    function go(i, j) {
      if (j >= q.length) return true;
      if (i >= name.length) return false;
      const key = i * 1000 + j;
      if (memo.has(key)) return false;
      memo.add(key);
      if (name[i] === q[j] && go(i + 1, j + 1)) return true;
      for (let len = Math.min(MAXKEY, name.length - i); len > 0; len--) {
        const rs = DICT.get(name.substr(i, len));
        if (!rs) continue;
        for (const r of rs) {
          const rest = q.slice(j);
          if (rest.startsWith(r)) { if (go(i + len, j + r.length)) return true; }
          else if (r.startsWith(rest) && (j > 0 || rest.length >= 2)) return true;   // 打っている途中
        }
      }
      return false;
    }
    for (let i = 0; i < name.length; i++) { if (go(i, 0)) return true; }
    return false;
  }

  const cache = new Map();
  function keysFor(company, extra) {
    const id = company + " " + (extra || "");
    let k = cache.get(id);
    if (k) return k;
    const name = norm(company);
    k = [name];
    ALIAS_N.forEach(([key, list]) => { if (key && name.includes(key)) k.push(...list); });
    String(extra || "").split(/[、,\/|\n　 ]+/).map(norm).filter(Boolean).forEach(x => k.push(x));
    // 読みに直した形(打ち間違いの許容に使う)
    let yomi = "";
    for (let i = 0; i < name.length;) {
      let len = Math.min(MAXKEY, name.length - i);
      while (len > 0 && !DICT.has(name.substr(i, len))) len--;
      if (len > 0) { yomi += DICT.get(name.substr(i, len))[0]; i += len; } else yomi += name[i++];
    }
    if (yomi !== name) k.push(yomi);
    k = Array.from(new Set(k.filter(Boolean)));
    cache.set(id, k);
    return k;
  }

  // 打った言葉の言い換え候補
  function queryForms(query) {
    const base = norm(query);
    if (!base) return [];
    const forms = new Set([base]);
    // 日本語入力の途中(「らくt」)は末尾の英字を落とす
    const trimmed = base.replace(/([ぁ-ん])[a-z]{1,2}$/, "$1");
    forms.add(trimmed);
    if (/^[a-z]+$/.test(base) && base.length >= 3) {
      const kana = romaToKana(base) || romaToKana(base.replace(/[^aiueon]$/, ""));
      if (kana && kana.length >= 2) forms.add(norm(kana));
    }
    // 漢字で打ったのに登録がかな・英字のとき
    ALIAS_N.forEach(([key, list]) => { if (list.includes(base)) forms.add(key); });
    return Array.from(forms);
  }

  // ぴったり寄りの一致
  function match(company, query, extra) {
    const forms = queryForms(query);
    if (!forms.length) return true;
    const name = norm(company);
    const keys = keysFor(company, extra);
    return forms.some(q =>
      keys.some(k => k.includes(q)) ||
      (name.length >= 3 && q.includes(name)) ||
      matchReading(name, q));
  }

  // q の打ち間違い(max 文字まで)を許して key のどこかに含まれるか
  function near(key, q, max) {
    let prev = new Array(key.length + 1).fill(0);
    for (let j = 1; j <= q.length; j++) {
      const cur = [j];
      for (let i = 1; i <= key.length; i++) cur[i] = Math.min(prev[i] + 1, cur[i - 1] + 1, prev[i - 1] + (key[i - 1] === q[j - 1] ? 0 : 1));
      prev = cur;
    }
    return Math.min(...prev) <= max;
  }
  function loose(company, query, extra) {
    return queryForms(query).some(q => q.length >= 4 && keysFor(company, extra).some(k => near(k, q, q.length >= 8 ? 2 : 1)));
  }

  // 一覧の絞り込み:ぴったり寄りで1件も無いときだけ、打ち間違いを許した結果を出す
  function filter(items, query, nameOf, extraOf) {
    if (!norm(query)) return items;
    const ex = extraOf || (() => "");
    const hit = items.filter(x => match(nameOf(x), query, ex(x)));
    return hit.length ? hit : items.filter(x => loose(nameOf(x), query, ex(x)));
  }

  return { norm, match, loose, filter };
})();
if (typeof module !== "undefined") module.exports = companySearch;
