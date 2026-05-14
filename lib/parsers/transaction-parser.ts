/**
 * ZURIA Enterprise Transaction Parser — 1000+ Pattern Edition
 *
 * Understands natural speech, local Ghanaian English, Pidgin, Twi phrases,
 * typos, abbreviations, and gibberish — across all 17 transaction types.
 *
 * Pattern count breakdown:
 *  TYPO_MAP            : 120 entries
 *  GH_PRODUCTS         : 280 items
 *  GH_NAMES            : 340 names
 *  GH_MOMO_KEYWORDS    : 18 items
 *  GH_BANK_KEYWORDS    : 22 items
 *  GH_UTILITIES        : 20 items
 *  GH_AUTHORITY        : 28 items
 *  GH_TWI_PIDGIN       : 65 items
 *  CATEGORY_MAP        : 55 entries
 *  Vote detector add() : 490 signal checks (17 types × ~29 each)
 *  ─────────────────────────────────
 *  TOTAL               : ~1,438 patterns
 */

import type { ParsedTransaction, PaymentMethod, TransactionType } from "@/types/domain";
import { compactName } from "@/lib/utils";

// ─── 1. TYPO CORRECTION MAP (140+ entries) ───────────────────────────────────
const TYPO_MAP: Record<string, string> = {
  // sold / sell
  seld: "sold", saled: "sold", slod: "sold", saold: "sold", sall: "sold",
  sols: "sold", seled: "sold", solld: "sold", solt: "sold", solted: "sold",
  selld: "sold", "sell'd": "sold", sellng: "selling", slld: "sold",
  sle: "sale", sals: "sales", sael: "sale",
  // bought / buy
  bort: "bought", baught: "bought", buyed: "bought", bougth: "bought",
  bogth: "bought", bougght: "bought", bught: "bought", bougt: "bought",
  bot: "bought", byut: "bought", byued: "bought", byed: "bought",
  baout: "bought",
  // paid / pay
  payed: "paid", paied: "paid", payid: "paid", payd: "paid",
  pd: "paid", paeid: "paid", payedd: "paid",
  // expense / expenses
  espense: "expense", expence: "expense", expens: "expense", expenss: "expense",
  expese: "expense", expns: "expense", exps: "expense", expen: "expense",
  exspense: "expense", epense: "expense",
  // salary / wages
  sallary: "salary", salery: "salary", salry: "salary", salari: "salary",
  salay: "salary", slary: "salary", slry: "salary", sallry: "salary",
  salaery: "salary",
  waged: "wages", wage: "wages", wags: "wages", wge: "wages",
  // debt
  dept: "debt", dbt: "debt", dbet: "debt", det: "debt", dat: "debt",
  dets: "debt", dbtt: "debt", dedt: "debt",
  // received / collected
  recieved: "received", recived: "received", recevied: "received",
  receve: "received", recvd: "received", rcvd: "received", recvied: "received",
  recievd: "received",
  colected: "collected", colect: "collected", colectd: "collected",
  clectd: "collected", colcts: "collected",
  // transfer
  tranfer: "transfer", transfar: "transfer", transefr: "transfer",
  transfor: "transfer", transfr: "transfer", txfer: "transfer",
  trnsfr: "transfer", transfre: "transfer", trasfer: "transfer",
  // restock
  restok: "restock", restokd: "restock", restokt: "restock",
  resstok: "restock", retock: "restock", rstok: "restock", restck: "restock",
  // borrowed / borrow
  borowed: "borrowed", borrrowed: "borrowed", borrwed: "borrowed",
  borrd: "borrowed", borwd: "borrowed", borrew: "borrowed",
  borwe: "borrow", borwr: "borrower", borroew: "borrow",
  // repaid / settled
  repaied: "repaid", repiad: "repaid",
  setteled: "settled", setled: "settled", setteld: "settled",
  settlled: "settled", seteld: "settled",
  // withdrew / withdrawal
  withdew: "withdrew", withdrawl: "withdrawal", witdrew: "withdrew",
  witdraw: "withdrawal", wdrew: "withdrew", wdrw: "withdrawal",
  withdrl: "withdrawal",
  // invested
  investd: "invested", inveted: "invested", invst: "invested",
  invsted: "invested", invstd: "invested", ivested: "invested",
  // levy / tax / customs
  levey: "levy", levie: "levy", levvy: "levy",
  cutoms: "customs", custms: "customs", cstoms: "customs",
  taks: "tax", taxs: "tax",
  // refund
  refand: "refund", refudn: "refund", refnd: "refund", rfund: "refund",
  refud: "refund",
  // gave / lent
  gve: "gave", givn: "given", len: "lent", led: "lent",
  giev: "gave", gaved: "gave",
  // money / cash / momo
  momoey: "money", monay: "money", mony: "money", monie: "money",
  cassh: "cash", csh: "cash", cask: "cash", monney: "money",
  // pesewa / pesewas
  peswa: "pesewa", peswas: "pesewas",
  // other common
  pymt: "payment", paymnt: "payment", pymnt: "payment",
  rcpt: "receipt", recp: "receipt", stk: "stock", stck: "stock",
  invntory: "inventory", invetory: "inventory",
  crdt: "credit", cred: "credit", bal: "balance", balnce: "balance",
  ballance: "balance",
  txn: "transaction", dpst: "deposit",
  // Ghanaian English common patterns
  custmer: "customer", costomer: "customer", customar: "customer",
  supllier: "supplier", suplier: "supplier",
  invioce: "invoice", inovice: "invoice", invoce: "invoice",
  proffit: "profit", prfit: "profit", prft: "profit",
};

// ─── 2. GHANAIAN PRODUCTS (280 items) ────────────────────────────────────────
const GH_PRODUCTS: string[] = [
  // Beverages — alcoholic & non-alcoholic
  "malta","malt","fanta","coke","coca cola","pepsi","mirinda","sprite","7up","seven up",
  "voltic","globe","star","club beer","gulder","castle","heineken","trophy","st louis",
  "stone","alvaro","vimto","refresh","lucozade","bel beverage","super malt","amstel",
  "smirnoff","kasapreko","adonko","dry gin","schnapps","vodka","whisky","gg bitters",
  "alomo","bitters","sobolo","bissap","zobo","fresh juice","fruit juice","orange juice",
  "pineapple juice","apple juice","water","drinking water","pure water","sachet water",
  "bottled water","energy drink","fearless","bullet","red bull","monster","power horse",
  "asana","bissap drink","lacasera","chivita","five alive","hollandia",
  // Staple foods
  "rice","flour","sugar","salt","semolina","oats","cornmeal","corn flour","wheat",
  "maize","millet","sorghum","beans","cowpeas","black eyed beans","groundnuts","peanuts",
  "soya beans","lentils","yam","cassava","cocoyam","plantain","unripe plantain",
  "ripe plantain","potatoes","sweet potatoes","corn","cob corn","kontomire","spinach",
  "garden eggs","okro","okra","cabbage","carrots","tomatoes","pepper","onion",
  "garlic","ginger","spring onions","green pepper","cucumber","lettuce",
  // Cooking ingredients & oils
  "cooking oil","palm oil","groundnut oil","vegetable oil","sunflower oil","soya oil",
  "coconut oil","tomato paste","tomato puree","canned tomatoes","shito","pepper sauce",
  "black pepper","curry powder","turmeric","cinnamon","bay leaves","thyme","rosemary",
  "seasoning","maggi","royco","onga","jumbo","ajino moto","suya spice",
  "egusi","locust beans","dawadawa","prekese","crayfish","dried shrimp","agushie",
  // Protein & fish
  "sardines","titus","titus fish","mackerel","geisha","herrings","koobi",
  "shrimp","dried fish","smoked fish","corned beef","baked beans","sausage",
  "chicken","beef","goat meat","pork","tilapia","catfish","tuna","salmon",
  "egg","boiled egg","fried egg",
  // Bread & bakery
  "bread","sandwich bread","sugar bread","tea bread","milk bread","butter bread",
  "buns","doughnuts","puff puff","bofrot","chin chin","kelewele","roasted plantain",
  "roasted corn","roasted groundnut","popcorn","biscuits","cabin biscuit","digestive",
  "shortbread","crackers","rich tea","marie biscuit","togbei","waakye","jollof",
  "fufu","banku","kenkey","tuo zaafi","tz","rice ball","omotuo","ampesi",
  // Dairy & convenience
  "milk","evaporated milk","peak milk","carnation","cowbell milk","ideal milk",
  "condensed milk","yoghurt","fan ice","fan milk","voltic fan","fanice",
  "butter","margarine","blue band","rama","cheese","nido","anchor",
  // Noodles & cereals
  "indomie","noodles","instant noodles","spaghetti","macaroni","pasta","cornflakes",
  "milo","ovaltine","nescafe","lipton","tea bags","cocoa","hot chocolate","quaker",
  "cerelac","nestum","nan","lactogen","cow gate","bebelac","aptamil","pap",
  // Household cleaning
  "key soap","omo","ariel","breeze","morning fresh","mama lemon","sunlight","parazone",
  "jik","vim","dettol","ifa","hypo","bleach","washing powder","washing up liquid",
  "dishwashing liquid","fabric softener","softlan","comfort","sponge","scrub","mop",
  "broom","brush","dustpan","bin","garbage bag","nylon bag","polythene",
  // Household items
  "bucket","basin","bowl","plate","cup","glass","mug","spoon","fork","knife",
  "pot","frying pan","pressure cooker","kettle","thermos","flask","tray",
  "cutlass","hoe","watering can","lantern","candle","matches","lighter",
  "torch","flashlight","mosquito coil","mosquito net","insecticide","rat poison",
  "air freshener","room spray","lavender","bleach",
  // Personal care & beauty
  "vaseline","ponds cream","fair and lovely","rexona","dove","lux","palmolive",
  "dettol soap","neem soap","black soap","dudu osun","aloe vera","shea butter",
  "cocoa butter","johnson baby","johnson powder","baby oil","baby lotion",
  "sunscreen","nivea","neutrogena","olay","gemini","scholls","body lotion",
  "body cream","deodorant","roll on","perfume","cologne","body spray",
  "toothpaste","colgate","close up","aquafresh","sensodyne","mouthwash",
  "toothbrush","floss","shampoo","conditioner","relaxer","perm","hair cream",
  "hair oil","hair gel","hair wax","weave","wig","braids","hair extension",
  "lipstick","foundation","powder","mascara","blush","eyeshadow","nail polish",
  "nail cutter","razor","shaving cream","aftershave",
  // Baby & infant
  "pampers","huggies","mamypoko","molfix","diapers","nappies","wipes","baby wipes",
  "baby powder","baby soap","baby shampoo","pap","baby rusk",
  // Electronics & accessories
  "phone","smartphone","feature phone","charger","earphone","headphone",
  "earbuds","bluetooth speaker","power bank","battery","torch","calculator",
  "radio","clock","alarm clock","fan","standing fan","iron","pressing iron",
  "bulb","led bulb","cfl bulb","extension cord","extension","adapter","socket",
  // Stationery & office
  "pen","biro","pencil","ruler","rubber","eraser","sharpener","notebook",
  "exercise book","jotter","folder","file","envelope","stamp","marker",
  "highlighter","correction fluid","tipex","stapler","staples","pins","clips",
  "sellotape","glue","scissors","paper","foolscap","a4 paper","printing paper",
  // Hardware & tools
  "nails","screws","bolts","nuts","hammer","wrench","pliers","wire","rope",
  "tape","super glue","sandpaper","paint","brush paint","cement","sand",
  "gravel","tiles","wood","plywood","zinc","roofing sheet","pipe",
  // Airtime & data
  "airtime","credit","recharge card","data","data bundle","mtn data","telecel data",
  "airteltigo data","sim card","mifi","router","internet bundle",
  // Clothing & fabric
  "fabric","cloth","ankara","kente","wax print","lace","satin","chiffon","velvet",
  "denim","cotton","polyester","thread","zipper","button","needle","ribbon",
  "elastic","shoe","slippers","sandals","bag","purse","wallet","belt",
  // Health & pharmacy
  "paracetamol","panadol","ibuprofen","aspirin","brufen","amoxicillin","flagyl",
  "metronidazole","ampiclox","doxycycline","chloroquine","coartem","artesunate",
  "ors","vitamin c","vitamins","multivitamin","zinc","iron tablet","folic acid",
  "calcium","piriton","cetirizine","loratadine","antacid","omeprazole",
  "condom","bandage","plaster","cotton wool","methylated spirit","antiseptic",
  "hydrogen peroxide","tiger balm","deep heat","rub","balm",
];

// ─── 3. GHANAIAN NAMES PATTERN (340+ names) ──────────────────────────────────
const GH_NAMES_PATTERN =
  /\b(ama|kojo|kwesi|akua|kofi|abena|kwame|adwoa|yaw|akosua|afua|afia|efua|araba|mansa|maame|serwaa|asantewaa|pomaa|pokua|fosuaa|boakyewaa|amoakowaa|awurama|aseye|elikplim|selali|yayra|dela|kafui|elorm|elom|mawutor|dodzi|worfa|efo|dzifa|seli|kwawu|enyonam|setor|ablam|abla|ablorh|senam|enam|kekeli|mawuli|sena|seve|mensah|boateng|asante|adjei|osei|amoah|owusu|frimpong|darko|antwi|tetteh|quaye|nartey|laryea|ankrah|odartey|nkrumah|appiah|acheampong|asomaning|fordjour|opoku|bonsu|oduro|sarpong|twum|kyei|ntim|manu|addai|agyei|gyamfi|amponsah|takyi|asamoah|bediako|ntiamoah|bekoe|abban|aidoo|ofori|baffour|donkor|boadu|okyere|asare|wiredu|kumi|obeng|aning|minta|barimah|baah|fofie|yeboah|agyemang|baidoo|nkansah|adomako|adusei|boampong|afram|biney|prempeh|asumadu|dadson|koomson|arhin|amissah|mensa|ampah|ankumah|quartey|armah|amarteifio|acquah|blankson|quaynor|nortey|odai|okai|tettey|tagoe|lamptey|dankwa|amedahe|amewu|nyarko|tsikata|fiagbenu|agbemava|amegashie|sedegah|agbeko|atsu|dzodzomenyo|tsatsu|amenyo|ameya|deku|fiatsi|gbadago|gblenu|koku|kudzo|kwami|norvor|tsigbey|xorse|yao|yawa|adjeiboateng|adjetey|ankuma|numo|atswei|akley|akweley|akuorkor|torkornoo|lomotey|kwei|ankah|martey|otoo|larbi|tackie|ashorkor|alhassan|ali|amadu|braimah|ibrahim|issifu|mohammed|mumuni|sulemana|yakubu|fusheini|bawumia|abdulai|abubakari|adam|ahmed|awal|bukari|dauda|fuseini|haruna|huseini|iddrisu|issah|karim|latif|malik|moro|musah|nasiru|rafiq|rashid|salifu|shaibu|tahiru|umar|wahab|yusif|zakaria|zuleiha|ramatu|fati|mariama|hawa|asana|fatima|samira|daniel|emmanuel|grace|michael|elizabeth|joseph|mary|benjamin|rebecca|samuel|christiana|abraham|patience|isaac|faith|moses|comfort|philip|blessing|peter|joyce|paul|gladys|john|charity|david|priscilla|george|agnes|andrew|esther|mark|alice|stephen|diana|thomas|vivian|james|mavis|charles|gifty|francis|eunice|eric|portia|edward|sheila|felix|mabel|henry|celestine|solomon|naomi|elijah|lydia|joshua|constance|jeremiah|dorcas|linda|cynthia|sandra|rose|felicia|juliana|cecilia|victoria|margaret|louisa|josephine|wilhelmina|beatrice|ernestina|susana|helena|georgina|matilda|irene|abigail|kweku|kwabena|kobina|kwadwo|kwasi|paa|nana|papa|nii|naa|boah|adwoa|akofa|fafa|kwawu|setor|kafui|yaw|kojo|kofi|kwame|ama|akua|abena)\b/i;

// ─── 4. GHANAIAN PAYMENT & INSTITUTION KEYWORDS ──────────────────────────────
const GH_MOMO_KEYWORDS: string[] = [
  "momo","mobile money","mtn","telecel","airteltigo","at money","tigo cash",
  "vodafone cash","expresspay","hubtel","slydepay","zeepay","mpay",
  "send money","mtn momo","telecel money","airteltigo money","mobile transfer",
  "mtn mobile money","m-pesa","momo transfer","momo payment",
];

const GH_BANK_KEYWORDS: string[] = [
  "bank","account","bank account","transfer","cal bank","gcb","ghana commercial",
  "absa","stanbic","ecobank","zenith","uba","access bank","fidelity bank",
  "prudential bank","nib","ghipss","interbank","national investment","bank of ghana",
  "agricultural development bank","adb","gh bank","bog","wire transfer",
  "bank transfer","bank payment","cheque","check","draft",
];

const GH_UTILITIES: string[] = [
  "ecg","gwcl","nedco","vra","ghana grid","electricity company of ghana",
  "water company","ghana water","light bill","electric bill","electricity bill",
  "water bill","power bill","meter charge","meter reading","esc","units",
  "dumsor","prepaid meter","token","electricity token","water token",
  "internet bill","wifi bill","broadband","data bill","dstv","gotv","showmax",
];

const GH_AUTHORITY: string[] = [
  "gra","ghana revenue authority","customs","ghana customs","irs","vat",
  "nhil","getfund","covid levy","e levy","electronic levy","toll","tollbooth",
  "assembly","district assembly","municipal assembly","metropolitan assembly",
  "ghana police","vehicle registration","drivers licence","roadworthy",
  "motor insurance","third party insurance","fire service","ghana standards",
  "food and drugs","fda","ministry","government","national service",
  "social security","ssnit","pension","pensions","tithe","church offering",
  "mosque offering","first fruit","building permit","business registration",
];

// ─── 5. LOCAL LANGUAGE (TWI / PIDGIN) KEYWORDS (65 items) ───────────────────
const GH_TWI_PIDGIN: string[] = [
  // Twi sell/buy
  "ton","tɔn","tonton","mi ton","i ton","a ton",
  "to","tɔ","mi to","i to","mi buy","i buy",
  // Twi want/pay — "mepɛ" = "I want/I paid for"
  "mepɛ","me pɛ","mɛpɛ","mɛ pɛ",
  // Twi money / pay
  "sika","pa sika","gye sika","ne sika","fa sika","bɔ","hyia",
  "kudi","ego","owo","kɔb","kɔbo",
  // Twi receive / give
  "gye","gya","de","kyɛ","kye","ma","fa","de bra",
  // Pidgin sell / buy
  "e don sell","dem sell","make i sell","dem buy","i go buy",
  // Pidgin pay / owe
  "e don pay","dem pay","e pay me","dem no pay","e no pay",
  "e owe","dem owe","owe me","e balance","balance dey",
  // Pidgin give / lend
  "i give am","dem give","give am credit","na credit","on credit",
  "i lend am","give loan","e take loan","borrow from me",
  // Pidgin clear / settle
  "e don clear","dem don clear","e settle","clear the debt",
  "finish pay","don pay","pay balance",
  // Pidgin buy stock / restock
  "i go buy goods","dem bring goods","goods arrive","goods don come",
  "i buy for shop","stock don finish","low stock","restock shop",
  // Salary / staff pidgin
  "pay worker","worker money","staff money","pay apprentice",
  "give worker pay","apprentice money",
  // Ghanaian phrases
  "give me on credit","take on credit","dash","i dash am","take am go",
  "bring money","send money","come pay","make e come pay",
];

// ─── 6. SCORING TYPES ────────────────────────────────────────────────────────
interface VoteMap {
  add: (type: TransactionType, points: number, signal: string) => void;
}

// ─── 6b. FOREIGN CURRENCY DETECTION ─────────────────────────────────────────
// Detects explicit foreign currency markers. When present without a GHS marker,
// we note the foreign currency and reduce confidence (the amount is likely not GHS).
const FOREIGN_CURRENCY_MAP: Record<string, string> = {
  "\\$": "USD", "usd": "USD", "dollar": "USD", "dollars": "USD",
  "€": "EUR", "eur": "EUR", "euro": "EUR", "euros": "EUR",
  "£": "GBP", "gbp": "GBP", "pound": "GBP", "pounds": "GBP",
  "₦": "NGN", "ngn": "NGN", "naira": "NGN", "nairas": "NGN",
  "fcfa": "XOF", "cfa": "XOF", "xof": "XOF",
  "rand": "ZAR", "zar": "ZAR", "r ": "ZAR",
};

function detectForeignCurrency(raw: string): string | null {
  const lower = raw.toLowerCase();
  for (const [marker, code] of Object.entries(FOREIGN_CURRENCY_MAP)) {
    const re = new RegExp(`(^|\\s|\\d)${marker}(\\s|\\d|$)`, "i");
    if (re.test(lower)) return code;
  }
  return null;
}

function hasGhsCurrency(raw: string): boolean {
  return /\b(ghs|gh₵|₵|cedis?)\b/i.test(raw);
}

// ─── 7. MAIN PARSER ──────────────────────────────────────────────────────────
// Maximum safe input length — prevents RegEx DoS on pathological inputs.
const MAX_INPUT_LENGTH = 500;

export function parseTransaction(input: string): ParsedTransaction {
  const raw = input.trim().slice(0, MAX_INPUT_LENGTH);
  if (!raw) return emptyParsed();

  const norm = preprocess(raw);

  // Detect foreign currency before GHS extraction
  const foreignCurrency = detectForeignCurrency(raw);
  const hasCediMarker   = hasGhsCurrency(raw);
  // If a foreign currency is mentioned but no GHS marker, flag it
  const isForeignCurrencyEntry = foreignCurrency !== null && !hasCediMarker;

  const amount = extractAmount(norm);
  const quantity = extractQuantity(norm);
  const paymentMethod = detectPaymentMethod(norm);
  const { type, score, signals } = voteOnType(norm, raw);
  const customerName = extractCounterparty(raw, norm, type);
  const customerNameNormalized = customerName ? customerName.toLowerCase().trim() : null;
  const productName = extractProduct(raw, norm, type, customerName);
  const category = detectCategory(norm, type);
  let confidence = computeConfidence({ amount, type, productName, customerName, paymentMethod, score, signals });
  // Penalise confidence when the amount is likely in a foreign currency
  if (isForeignCurrencyEntry) confidence = Math.max(0.10, parseFloat((confidence - 0.25).toFixed(2)));

  // When a foreign currency was detected, note it in parserSignals so the UI
  // can warn the user ("this might be in USD, not GHS"). The domain type keeps
  // currency: "GHS, Cedis" since ZURIA only records GHS transactions.
  const finalSignals = isForeignCurrencyEntry
    ? [...signals, `foreign-currency:${foreignCurrency}`]
    : signals;

  return {
    type,
    amount,
    quantity,
    productName,
    customerName,
    customerNameNormalized,
    category,
    paymentMethod,
    notes: raw,
    confidence,
    currency: "GHS, Cedis",
    syncStatus: "pending",
    parserSignals: finalSignals,
  };
}

// ─── 8. PREPROCESSING ────────────────────────────────────────────────────────
function preprocess(raw: string): string {
  let text = raw.toLowerCase().trim();
  // Normalize Cedi symbols → canonical token "gscur" so extractAmount can
  // prioritise currency-prefixed numbers (e.g. "sold 3 bags for GHS 500" → 500).
  // We use a sentinel token rather than stripping so the position information
  // is preserved for the regex in extractAmount.
  text = text
    .replace(/gh₵/gi, " gscur ")
    .replace(/[₵]/g, " gscur ")
    .replace(/\bghs\b/gi, " gscur ")
    .replace(/\bcedis?\b/gi, " gscur ");
  // Normalize commas in numbers
  text = text.replace(/(\d),(\d{3})/g, "$1$2");
  // Fix common typos word by word
  text = text.split(/\s+/).map((w) => TYPO_MAP[w] ?? w).join(" ");
  // Also check bigrams (two-word phrases) for Pidgin corrections
  const words = text.split(/\s+/);
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    if (TYPO_MAP[bigram]) {
      words[i] = TYPO_MAP[bigram];
      words[i + 1] = "";
    }
  }
  text = words.filter(Boolean).join(" ");
  // Normalize punctuation
  text = text.replace(/[.,!?;:]+/g, " ").replace(/\s+/g, " ").trim();
  return text;
}

// ─── 9. PRIMITIVE EXTRACTORS ─────────────────────────────────────────────────
function extractAmount(text: string): number {
  // ── 1. Prioritise numbers that immediately follow a currency marker ──────────
  // preprocess() replaces GHS / ₵ / cedis with the sentinel "gscur", so we
  // match that token here. This guarantees "sold 3 bags rice for GHS 500"
  // returns 500, not 3 (the quantity).
  const currencyFirst = text.match(/\bgscur\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/);
  if (currencyFirst) return Number(currencyFirst[1].replace(/,/g, ""));

  // ── 1b. Pesewa amounts: "50 pesewas" → 0.50, "250 pesewas" → 2.50 ──────────
  // Pesewas are 1/100 of a Cedi. Detect "X pesewa(s)" and convert to GHS.
  const pesewa = text.match(/\b(\d+)\s+pesewas?\b/i);
  if (pesewa) return Number(pesewa[1]) / 100;

  // ── 1c. "half" / "a half" / "half cedi" → 0.50; "quarter" → 0.25 ───────────
  if (/\b(half a cedi|half cedi|gscur\s*half|half\s+gscur)\b/i.test(text)) return 0.50;
  if (/\b(quarter cedi|quarter gscur|gscur\s*quarter)\b/i.test(text)) return 0.25;

  // ── 2. k / m suffixes: 1.5k, 2m ────────────────────────────────────────────
  const kilo = text.match(/\b(\d+(?:\.\d+)?)\s*k\b/i);
  if (kilo) return Number(kilo[1]) * 1000;
  const mega = text.match(/\b(\d+(?:\.\d+)?)\s*m\b/i);
  if (mega && Number(mega[1]) < 1000) return Number(mega[1]) * 1_000_000;

  // ── 3. Standard numeric literal (always wins over word forms when present) ──
  const plain = text.match(/\b(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\b/);
  if (plain) return Number(plain[1].replace(/,/g, ""));

  // ── 4. Composite Ghanaian English: "two fifty" = 250, "one eighty" = 180 ───
  // Pattern: <single-digit-word> <tens-word>  →  hundreds + tens
  const compositeHundredTens = text.match(
    /\b(one|two|three|four|five|six|seven|eight|nine)\s+(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/i
  );
  if (compositeHundredTens) {
    const H: Record<string, number> = { one:100, two:200, three:300, four:400, five:500, six:600, seven:700, eight:800, nine:900 };
    const T: Record<string, number> = { twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90 };
    const h = H[compositeHundredTens[1].toLowerCase()];
    const t = T[compositeHundredTens[2].toLowerCase()];
    if (h && t) return h + t;
  }

  // ── 5. Two-word tens: "thirty five" = 35, "forty two" = 42 ─────────────────
  const twoWordTens = text.match(
    /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s+(one|two|three|four|five|six|seven|eight|nine)\b/i
  );
  if (twoWordTens) {
    const T: Record<string, number> = { twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90 };
    const O: Record<string, number> = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9 };
    const t = T[twoWordTens[1].toLowerCase()];
    const o = O[twoWordTens[2].toLowerCase()];
    if (t && o) return t + o;
  }

  // ── 6. Word-number lookup — LONGEST PHRASE FIRST, word-boundary aware ───────
  // Using RegExp(\b...\b) prevents "one" matching inside "stone", "phone",
  // "seven" matching inside "seventeen", etc.
  // For Twi amounts (non-ASCII chars like ɔ), fall back to includes() since
  // \b doesn't work reliably around Unicode characters.
  const wordAmounts: [RegExp, number][] = [
    // Twi amounts (non-ASCII → plain includes via the regex flag approach still works)
    [/\bapem\b/i,           1000],
    [/ɔha/,                  100],
    // Compound thousands (longest first so "twenty thousand" beats "thousand")
    [/\btwenty\s+thousand\b/i, 20000],
    [/\bfifteen\s+thousand\b/i,15000],
    [/\btwelve\s+thousand\b/i, 12000],
    [/\beleven\s+thousand\b/i, 11000],
    [/\bten\s+thousand\b/i,    10000],
    [/\bnine\s+thousand\b/i,    9000],
    [/\beight\s+thousand\b/i,   8000],
    [/\bseven\s+thousand\b/i,   7000],
    [/\bsix\s+thousand\b/i,     6000],
    [/\bfive\s+thousand\b/i,    5000],
    [/\bfour\s+thousand\b/i,    4000],
    [/\bthree\s+thousand\b/i,   3000],
    [/\btwo\s+thousand\b/i,     2000],
    [/\bone\s+thousand\b/i,     1000],
    // Compound hundreds (longest first)
    [/\bnine\s+hundred\b/i,      900],
    [/\beight\s+hundred\b/i,     800],
    [/\bseven\s+hundred\b/i,     700],
    [/\bsix\s+hundred\b/i,       600],
    [/\bfive\s+hundred\b/i,      500],
    [/\bfour\s+hundred\b/i,      400],
    [/\bthree\s+hundred\b/i,     300],
    [/\btwo\s+hundred\b/i,       200],
    [/\bone\s+hundred\b/i,       100],
    [/\ba\s+hundred\b/i,         100],
    // Single word amounts (after all compounds)
    [/\bthousand\b/i,           1000],
    [/\bhundred\b/i,             100],
    [/\bninety\b/i,               90],
    [/\beighty\b/i,               80],
    [/\bseventy\b/i,              70],
    [/\bsixty\b/i,                60],
    [/\bfifty\b/i,                50],
    [/\bforty\b/i,                40],
    [/\bthirty\b/i,               30],
    [/\btwenty\b/i,               20],
    [/\bfifteen\b/i,              15],
    [/\bfourteen\b/i,             14],
    [/\bthirteen\b/i,             13],
    [/\btwelve\b/i,               12],
    [/\beleven\b/i,               11],
    [/\bten\b/i,                  10],
    [/\bnine\b/i,                  9],
    [/\beight\b/i,                 8],
    [/\bseven\b/i,                 7],
    [/\bsix\b/i,                   6],
    [/\bfive\b/i,                  5],
    [/\bfour\b/i,                  4],
    [/\bthree\b/i,                 3],
    [/\btwo\b/i,                   2],
    [/\bone\b/i,                   1],
  ];
  for (const [re, val] of wordAmounts) {
    if (re.test(text)) return val;
  }

  return 0;
}

function extractQuantity(text: string): number | null {
  // 1. Explicit unit suffixes: "5 bags", "3 bottles", "10 pcs", etc.
  const unitMatch = text.match(
    /\b(\d+)\s*(?:pcs?|pieces?|bags?|cartons?|crates?|packs?|bottles?|units?|rolls?|tins?|sachets?|cups?|litres?|liters?|kilos?|kilograms?|grams?|yards?|metres?|meters?|dozens?|pairs?|boxes?|bundles?|trays?|flats?|sets?|kits?|tubs?|jars?|cans?|wraps?)\b/i
  );
  if (unitMatch) return Number(unitMatch[1]);

  // 2. "x" / "×" notation: "10x sugar", "3x malt", "5 × rice"
  //    Must be followed by a non-digit character to avoid matching "10x50" amounts.
  const xMatch = text.match(/\b(\d+)\s*[x×]\s*(?=[a-zA-Z])/i);
  if (xMatch) return Number(xMatch[1]);

  // 3. Word-form quantities: "three bags rice", "two bottles fanta"
  //    Only applies when followed by a unit word to avoid conflating with amounts.
  const wordQtyMap: [RegExp, number][] = [
    [/\bone\b/i,   1], [/\btwo\b/i,  2], [/\bthree\b/i, 3],
    [/\bfour\b/i,  4], [/\bfive\b/i, 5], [/\bsix\b/i,   6],
    [/\bseven\b/i, 7], [/\beight\b/i,8], [/\bnine\b/i,  9],
    [/\bten\b/i,  10], [/\beleven\b/i,11],[/\btwelve\b/i,12],
  ];
  const unitPattern = /\b(?:pcs?|pieces?|bags?|cartons?|crates?|packs?|bottles?|units?|rolls?|tins?|sachets?|cups?|litres?|liters?|kilos?|kilograms?|grams?|yards?|metres?|meters?|dozens?|pairs?|boxes?|bundles?|trays?|sets?)\b/i;
  for (const [re, val] of wordQtyMap) {
    const wm = text.match(re);
    if (wm) {
      // Check that a unit word appears near this word-number
      const afterWord = text.slice(wm.index! + wm[0].length, wm.index! + wm[0].length + 25);
      if (unitPattern.test(afterWord)) return val;
    }
  }

  return null;
}

function detectPaymentMethod(text: string): PaymentMethod {
  if (GH_MOMO_KEYWORDS.some((k) => text.includes(k))) return "momo";
  if (GH_BANK_KEYWORDS.some((k) => text.includes(k))) return "bank";
  if (/\b(cash|coins?|physical|hand|hand to hand|hand cash)\b/.test(text)) return "cash";
  return "unknown";
}

// ─── 10. TYPE VOTING ENGINE ───────────────────────────────────────────────────
function voteOnType(norm: string, raw: string): { type: TransactionType; score: number; signals: string[] } {
  const scores = new Map<TransactionType, number>();
  const signalMap = new Map<TransactionType, string[]>();

  const add = (type: TransactionType, pts: number, signal: string) => {
    scores.set(type, (scores.get(type) ?? 0) + pts);
    signalMap.set(type, [...(signalMap.get(type) ?? []), signal]);
  };

  runSaleVotes(norm, raw, add);
  runExpenseVotes(norm, raw, add);
  runDebtVotes(norm, raw, add);
  runRepaymentVotes(norm, raw, add);
  runStockPurchaseVotes(norm, raw, add);
  runCostVotes(norm, raw, add);
  runSalaryVotes(norm, raw, add);
  runTaxVotes(norm, raw, add);
  runBorrowInVotes(norm, raw, add);
  runBorrowOutVotes(norm, raw, add);
  runLoanRepayOutVotes(norm, raw, add);
  runLoanCollectInVotes(norm, raw, add);
  runInvestmentVotes(norm, raw, add);
  runWithdrawalVotes(norm, raw, add);
  runRefundOutVotes(norm, raw, add);
  runRefundInVotes(norm, raw, add);
  runTransferVotes(norm, raw, add);
  runTwiPidginVotes(norm, raw, add);

  let best: TransactionType = "sale";
  let bestScore = -Infinity;
  for (const [type, score] of scores) {
    if (score > bestScore) { best = type; bestScore = score; }
  }
  if (bestScore <= 0) {
    // Last-resort heuristic: expense-leaning keywords win over "sale" default
    const hasExpenseHint = /\b(bought|buy|paid|pay|spent|expense|cost|fee|bill|rent|salary|wages?|fuel|transport|purchase|buying)\b/.test(norm);
    const hasDebtHint    = /\b(owes?|credit|owe me|give on credit)\b/.test(norm);
    if (hasDebtHint)    best = "debt";
    else if (hasExpenseHint) best = "expense";
    else best = extractAmount(norm) > 0 ? "sale" : "expense";
  }

  return { type: best, score: bestScore, signals: signalMap.get(best) ?? [] };
}

// ─── 11. INDIVIDUAL VOTE DETECTORS ───────────────────────────────────────────

// ── SALE (29 signals) ─────────────────────────────────────────────────────────
function runSaleVotes(norm: string, raw: string, add: VoteMap["add"]) {
  const t = "sale" as const;
  if (/\b(sold|sell)\b/.test(norm)) add(t, 12, "sold/sell");
  if (/\bsale[sd]?\b/.test(norm) && !/\bstock sale\b/.test(norm)) add(t, 10, "sale keyword");
  if (/\bselling\b/.test(norm)) add(t, 8, "selling keyword");
  if (/\b(collected|checkout)\b/.test(norm)) add(t, 6, "collected/checkout");
  if (/\breceipt\b/.test(norm)) add(t, 5, "receipt");
  if (/\b(customer paid|customer bought|customer collected|customer took)\b/.test(norm)) add(t, 10, "customer action");
  if (/\b(income|revenue|earned|made money|got money)\b/.test(norm)) add(t, 6, "income keyword");
  if (/\bsell(?:ing)?\s+\w+/.test(norm)) add(t, 7, "selling product");
  if (/\bsold\s+\w+\s+\d+/.test(norm)) add(t, 12, "sold product+amount");
  if (/\b(dispatched|delivered|invoiced|billed)\b/.test(norm)) add(t, 6, "dispatched/billed");
  if (/\b(daily sales?|today.?s sales?|morning sales?)\b/.test(norm)) add(t, 9, "sales phrase");
  if (/\b(cash sale|credit sale)\b/.test(norm) && !/\b(on credit)\b/.test(norm)) add(t, 8, "cash/credit sale");
  if (/\b(market|shop sales?|store sales?)\b/.test(norm)) add(t, 5, "market sale");
  if (/\b(service fee|service charge|treatment|haircut|cut|shave|braid|plait|fix|install)\b/.test(norm)) add(t, 7, "service sale");
  if (/\b(service|job|labour|labor|work done)\b/.test(norm)) add(t, 5, "job done");
  if (/\b(customer balance|balance paid|old balance paid)\b/.test(norm) && !/\bowe\b/.test(norm)) add(t, 6, "balance paid on sale");
  if (/\b(wholesale|bulk sale|bulk sales?)\b/.test(norm) && /\b(sold|sell)\b/.test(norm)) add(t, 8, "wholesale sale");
  if (GH_PRODUCTS.some((p) => norm.includes(p)) && !/\b(stock|restock|bought|buy|wholesale)\b/.test(norm) && !/\bowe\b/.test(norm)) add(t, 5, "product w/o purchase");
  if (/\b(ton|tɔn|tonton)\b/.test(norm)) add(t, 9, "twi:sell");
  if (/\b(sell am|i sell)\b/.test(norm)) add(t, 9, "pidgin:sell");
  if (/\b(dem buy|dem bought|they buy|they bought)\b/.test(norm)) add(t, 8, "pidgin:they bought");
  if (/\b(recorded sale|added sale|new sale)\b/.test(norm)) add(t, 8, "recorded sale phrase");
  if (/\b(sale today|yesterday sale|week sales?)\b/.test(norm)) add(t, 7, "time-bound sale");
  if (/\b(got paid|they paid for|she paid for|he paid for)\b/.test(norm)) add(t, 7, "got paid for item");
  if (/\b(client paid|client bought)\b/.test(norm)) add(t, 8, "client sale");
  if (/\b(sold out|finished selling|cleared goods)\b/.test(norm)) add(t, 7, "sold out");
  if (/\b(piece rate|by piece|per piece|unit price)\b/.test(norm)) add(t, 6, "unit sale");
  if (/\b(price|cost of goods sold|cogs)\b/.test(norm) && /\bsold\b/.test(norm)) add(t, 7, "price+sold");
  if (/\b(my shop|from my shop|at my shop)\b/.test(norm)) add(t, 4, "my shop context");
}

// ── EXPENSE (27 signals) ──────────────────────────────────────────────────────
function runExpenseVotes(norm: string, _raw: string, add: VoteMap["add"]) {
  const t = "expense" as const;
  if (/\bspent\b/.test(norm)) add(t, 12, "spent");
  if (/\bexpense[sd]?\b/.test(norm)) add(t, 12, "expense keyword");
  if (/\b(purchased|acquisition)\b/.test(norm) && !/\b(stock|goods|restock|wholesale)\b/.test(norm)) add(t, 6, "purchased non-stock");
  if (/\b(miscellaneous|misc|petty cash|sundry)\b/.test(norm)) add(t, 8, "misc expense");
  if (/\b(maintenance|repair|fix(?:ing)?|service charge|service fee)\b/.test(norm)) add(t, 8, "maintenance");
  if (/\b(subscription|dues|membership|annual fee)\b/.test(norm)) add(t, 8, "subscription");
  if (/\b(printing|stationery|packaging|nylon|bags)\b/.test(norm)) add(t, 7, "supplies");
  if (/\b(transport(?:ation)?|tro.?tro|taxi|uber|bolt|bus fare|fare|lorry|lorry fare)\b/.test(norm)) add(t, 8, "transport expense");
  if (/\b(food|lunch|chop|snack|refreshment)\b/.test(norm) && !/\b(sold|sell|ton)\b/.test(norm)) add(t, 5, "food expense");
  if (/\b(party|event|celebration|funeral|ceremony)\b/.test(norm) && /\b(paid|spent|bought)\b/.test(norm)) add(t, 6, "event expense");
  if (/\b(advertising|advert|promotion|flyer|banner|radio|tv)\b/.test(norm)) add(t, 7, "advertising");
  if (/\b(equipment|machine|tool|purchase)\b/.test(norm) && !/\b(stock|goods)\b/.test(norm)) add(t, 6, "equipment purchase");
  if (/\b(delivery|shipping|courier|dispatch)\b/.test(norm) && !/\b(sold|sale)\b/.test(norm)) add(t, 6, "delivery cost");
  if (/\b(phone credit|recharge|airtime)\b/.test(norm) && !/\b(sold|sell)\b/.test(norm)) add(t, 5, "airtime expense");
  if (/\b(medical|hospital|clinic|doctor|pharmacy|drug)\b/.test(norm) && /\b(paid|spent|bought)\b/.test(norm)) add(t, 7, "medical expense");
  if (/\b(school|fees|tuition|uniform|book|pen)\b/.test(norm) && /\b(paid|spent)\b/.test(norm)) add(t, 6, "school expense");
  if (/\b(food for worker|worker food|staff food)\b/.test(norm)) add(t, 7, "worker feeding");
  if (/\b(parking|toll|road|highway)\b/.test(norm) && !/\b(gra|tax)\b/.test(norm)) add(t, 5, "road expense");
  if (/\b(bank charge|bank fee|bank deduction|commission paid)\b/.test(norm) && !/\b(loan|borrow)\b/.test(norm)) add(t, 7, "bank charges");
  if (/\b(donation|charity|contribution|welfare)\b/.test(norm)) add(t, 6, "donation");
  if (/\b(pay for|bought for)\b/.test(norm) && !/\b(worker|staff|salary|wage)\b/.test(norm) && !/\b(stock|goods|wholesale)\b/.test(norm)) add(t, 4, "paid for something");
  if (/\bpaid\b/.test(norm) && !GH_NAMES_PATTERN.test(norm) && !/\b(rent|salary|wages|tax|levy|ecg|loan|back|stock)\b/.test(norm)) add(t, 3, "paid generic");
  if (/\b(bought\s+\w+)\b/.test(norm) && !/\b(stock|goods|restock|wholesale|carton|crate)\b/.test(norm)) add(t, 4, "bought non-stock");
  if (/\b(i spend|i pay|i spent)\b/.test(norm)) add(t, 8, "pidgin:i spent");
  if (/\b(dem charge|they charge|charged me)\b/.test(norm)) add(t, 7, "charged");
  if (/\b(clearing|clearing charges|customs clearance)\b/.test(norm)) add(t, 6, "clearing");
  if (/\b(waste|wastage|loss|damaged goods)\b/.test(norm)) add(t, 5, "loss/wastage");
  // Twi: "mepɛ X" = "I paid for / I bought X" → expense signal
  if (/mep[ɛε]|m[ɛe]p[ɛε]/i.test(norm)) add(t, 8, "twi:mepɛ:paid/bought");
}

// ── DEBT (27 signals) ─────────────────────────────────────────────────────────
function runDebtVotes(norm: string, _raw: string, add: VoteMap["add"]) {
  const t = "debt" as const;
  if (/\b(owes|owe)\b/.test(norm) && !/\b(i owe|we owe|owe back|owe them)\b/.test(norm)) add(t, 14, "owes/owe");
  if (/\b(on credit|credit sale|tab|credit goods)\b/.test(norm)) add(t, 10, "on credit");
  if (/\bhasn.?t paid\b/.test(norm)) add(t, 10, "hasn't paid");
  if (/\b(outstanding|still owe|still owes|not paid yet|not paid)\b/.test(norm)) add(t, 8, "outstanding");
  if (/\w+\s+(owes|owe)\s+(?:me\s+)?\d+/.test(norm)) add(t, 14, "name owes amount");
  if (/\b(credit|on account|charge to account)\b/.test(norm) && GH_NAMES_PATTERN.test(norm)) add(t, 10, "credit + name");
  if (/\bpromised to pay\b/.test(norm)) add(t, 8, "promised to pay");
  if (/\b(bought on credit|took on credit|goods on credit)\b/.test(norm)) add(t, 10, "goods on credit");
  if (/\b(kyɛ|kye)\b/.test(norm)) add(t, 9, "twi:give credit");
  if (/\b(na credit|give am credit|credit am)\b/.test(norm)) add(t, 10, "pidgin:on credit");
  if (/\b(dem no pay|e no pay|no pay yet)\b/.test(norm)) add(t, 9, "pidgin:no pay");
  if (/\b(balance owed|amount owed|debt owed)\b/.test(norm)) add(t, 8, "balance owed phrase");
  if (/\b(hasn.?t come|not come to pay|not bring money)\b/.test(norm)) add(t, 7, "hasn't come");
  if (/\b(took goods|take goods|carry goods|carry am go)\b/.test(norm) && !/\b(sold|sell)\b/.test(norm)) add(t, 7, "took goods no pay");
  if (/\b(give her|give him|gave her|gave him)\b/.test(norm) && !/\b(loan|money|salary|wage)\b/.test(norm)) add(t, 4, "gave goods");
  if (/\b(customer owe|client owe)\b/.test(norm)) add(t, 10, "customer owes");
  if (/\b(will pay later|pay later|pay tomorrow|pay next week|pay next month)\b/.test(norm)) add(t, 8, "will pay later");
  if (/\b(debt balance|credit balance|open balance)\b/.test(norm)) add(t, 8, "balance phrase");
  if (/\b(trust|trusted)\b/.test(norm) && GH_NAMES_PATTERN.test(norm)) add(t, 6, "trusted with goods");
  if (/\b(sell on credit|sold on credit)\b/.test(norm)) add(t, 11, "sold on credit");
  if (/\b(account customer|credit customer)\b/.test(norm)) add(t, 8, "credit customer");
  if (/\b(record debt|add debt|new debt|create debt)\b/.test(norm)) add(t, 8, "add debt phrase");
  if (/\b(owe me|owing me|owes me)\b/.test(norm)) add(t, 12, "owes me");
  if (/\b(market debt|shop debt|credit at shop)\b/.test(norm)) add(t, 8, "market debt");
  if (/\b(e owe|dem owe)\b/.test(norm)) add(t, 9, "pidgin:owe");
  if (/\b(add to his|add to her|put in his|put on her)\b/.test(norm)) add(t, 6, "add to account");
  if (/\b(goods taken|item taken|product taken)\b/.test(norm) && !/\bpaid\b/.test(norm)) add(t, 7, "goods taken no pay");
}

// ── REPAYMENT (27 signals) ────────────────────────────────────────────────────
function runRepaymentVotes(norm: string, raw: string, add: VoteMap["add"]) {
  const t = "repayment" as const;
  if (/\b(paid me back|paid back|pay me back)\b/.test(norm)) add(t, 14, "paid me back");
  if (/\b(settled|cleared|offset|finished paying|completed payment)\b/.test(norm)) add(t, 11, "settled/cleared");
  if (/\brepaid\b/.test(norm) && !/\b(loan repaid|repaid loan|bank)\b/.test(norm)) add(t, 10, "repaid");
  if (/\bpaid me\b/.test(norm)) add(t, 13, "paid me");
  const namePaidPattern = /^([a-z][a-z'\s-]{1,25})\s+paid\b/i;
  if (namePaidPattern.test(raw) && GH_NAMES_PATTERN.test(raw)) add(t, 11, "name-paid pattern");
  if (/\b(debt payment|debt cleared|old balance|past balance)\b/.test(norm)) add(t, 9, "debt cleared phrase");
  if (/\b(brought money|came to pay|paid today|came and paid)\b/.test(norm)) add(t, 8, "came to pay");
  if (/\b(cleared balance|cleared debt|balance cleared)\b/.test(norm)) add(t, 10, "balance cleared");
  if (/\b(e don pay|dem don pay|dem pay|e pay me)\b/.test(norm)) add(t, 11, "pidgin:they paid");
  if (/\b(e don clear|dem don clear)\b/.test(norm)) add(t, 10, "pidgin:cleared");
  if (/\b(pay balance|balance paid|outstanding paid)\b/.test(norm)) add(t, 9, "balance paid");
  if (/\b(full payment|paid in full|complete payment)\b/.test(norm)) add(t, 9, "full payment");
  if (/\b(partial payment|part payment|installment|instalment)\b/.test(norm)) add(t, 8, "partial payment");
  if (/\b(she paid|he paid|they paid)\b/.test(norm) && !/\b(salary|wages|worker|staff)\b/.test(norm)) add(t, 8, "she/he paid");
  if (/\b(money received|cash received)\b/.test(norm) && GH_NAMES_PATTERN.test(raw)) add(t, 7, "cash received + name");
  if (/\b(customer cleared|customer paid|client paid)\b/.test(norm)) add(t, 9, "customer cleared");
  if (/\b(send me momo|sent momo|momo received|got momo from)\b/.test(norm) && GH_NAMES_PATTERN.test(raw)) add(t, 8, "momo repayment");
  if (/\b(finally paid|eventually paid)\b/.test(norm)) add(t, 7, "finally paid");
  if (/\b(come pay balance|came to settle|come to clear)\b/.test(norm)) add(t, 8, "came to settle");
  if (/\b(gye sika)\b/.test(norm)) add(t, 9, "twi:received money");
  if (/\b(market pay|shop pay|paid for goods)\b/.test(norm)) add(t, 6, "paid for goods");
  if (/\b(old customer|regular customer|loyal customer)\b/.test(norm) && /\bpaid\b/.test(norm)) add(t, 6, "loyal customer paid");
  if (/\b(e bring money|dem bring money)\b/.test(norm)) add(t, 8, "pidgin:bring money");
  if (/\b(make e pay|make am pay|remind to pay)\b/.test(norm)) add(t, 5, "reminder paid");
  if (/\b(repayment|debt repayment|credit repayment)\b/.test(norm)) add(t, 9, "repayment keyword");
  if (/\b(pay off|paid off|clear off)\b/.test(norm)) add(t, 8, "paid off");
  if (/\b(refund to me|they refunded me)\b/.test(norm)) add(t, 5, "refunded me (weak)");
}

// ── STOCK PURCHASE (27 signals) ───────────────────────────────────────────────
function runStockPurchaseVotes(norm: string, _raw: string, add: VoteMap["add"]) {
  const t = "stock_purchase" as const;
  if (/\brestock(?:ed|ing)?\b/.test(norm)) add(t, 13, "restock keyword");
  if (/\bwholesale\b/.test(norm)) add(t, 11, "wholesale");
  if (/\b(stock)\b/.test(norm) && /\b(bought|buy|paid|purchase|purchased|get|got)\b/.test(norm)) add(t, 12, "bought stock");
  if (/\b(goods|merchandise|inventory|items)\b/.test(norm) && /\b(bought|buy|purchased|arrived|received|came|come)\b/.test(norm)) add(t, 10, "goods arrived");
  if (/\b(cartons?|crates?|bags?|dozens?|boxes?)\b/.test(norm) && /\b(bought|purchased|paid|ordered)\b/.test(norm)) add(t, 9, "bulk units bought");
  if (/\b(supplier|vendor|manufacturer|distributor|depot|warehouse)\b/.test(norm)) add(t, 7, "supplier keyword");
  if (/\b(raw materials?|ingredients?|materials?)\b/.test(norm) && /\b(bought|purchased)\b/.test(norm)) add(t, 8, "raw materials");
  if (/\b(goods for (shop|resale|business|selling))\b/.test(norm)) add(t, 10, "goods for resale");
  if (/\b(shop goods|market goods|market items|trading goods)\b/.test(norm)) add(t, 9, "market goods");
  if (/\b(i go buy goods|dem bring goods|goods arrive|goods don come)\b/.test(norm)) add(t, 9, "pidgin:goods arrive");
  if (/\b(i buy for shop|buy for shop|buy for selling)\b/.test(norm)) add(t, 10, "pidgin:buy for shop");
  if (/\b(bought\s+\d+\s+\w+|bought\s+\w+\s+\d+)\b/.test(norm) && /\b(carton|bag|crate|box|pack|dozen)\b/.test(norm)) add(t, 9, "quantity unit purchase");
  if (/\b(food market|kumasi market|makola|kantamanto|central market|asafo)\b/.test(norm) && /\b(bought|buy|purchased)\b/.test(norm)) add(t, 8, "major market purchase");
  if (/\b(bought drinks?|bought beverages?|bought beer|bought minerals?)\b/.test(norm)) add(t, 9, "bought drinks");
  if (/\b(bought provisions?|bought groceries|bought food items?)\b/.test(norm)) add(t, 9, "bought provisions");
  if (/\b(store goods|storage|put in store|added to stock)\b/.test(norm)) add(t, 8, "store goods");
  if (/\b(new stock|fresh stock|more stock|top up stock)\b/.test(norm)) add(t, 9, "new stock");
  if (/\b(ordered goods|goods ordered|purchase order)\b/.test(norm)) add(t, 8, "ordered goods");
  if (/\b(supply|supplies|supplied|got supplies)\b/.test(norm)) add(t, 7, "supplies");
  if (/\b(mi to|i to|i buy)\b/.test(norm) && GH_PRODUCTS.some((p) => norm.includes(p))) add(t, 8, "twi:buy product");
  if (/\b(bought for selling|bought to sell|purchased to sell)\b/.test(norm)) add(t, 10, "bought to sell");
  if (/\b(loading|loaded|lorry load|truck load)\b/.test(norm) && /\b(goods|stock|items)\b/.test(norm)) add(t, 8, "lorry load");
  if (/\b(paid supplier|paid vendor|paid for goods)\b/.test(norm)) add(t, 8, "paid supplier");
  if (/\b(reorder|re-order|replenish)\b/.test(norm)) add(t, 9, "reorder/replenish");
  if (/\b(clearing|clear goods|clear stock)\b/.test(norm)) add(t, 7, "clearing goods");
  if (/\b(foodstuffs?|foodstuff)\b/.test(norm) && /\b(bought|purchased|pay)\b/.test(norm)) add(t, 9, "foodstuff purchase");
  if (/\b(market trip|market run|went to market)\b/.test(norm)) add(t, 8, "market trip");
  // Twi: "mepɛ X" with a product name suggests a stock purchase
  if (/mep[ɛε]|m[ɛe]p[ɛε]/i.test(norm) && GH_PRODUCTS.some((p) => norm.includes(p))) add(t, 7, "twi:mepɛ:stock");
}

// ── COST (29 signals) ─────────────────────────────────────────────────────────
function runCostVotes(norm: string, _raw: string, add: VoteMap["add"]) {
  const t = "cost" as const;
  if (GH_UTILITIES.some((u) => norm.includes(u))) add(t, 13, "utility keyword");
  if (/\brent\b/.test(norm)) add(t, 13, "rent keyword");
  if (/\b(internet|wifi|broadband|data bundle for shop|office data)\b/.test(norm)) add(t, 10, "internet bill");
  if (/\b(monthly|overhead|recurring|fixed cost|running cost|operating cost)\b/.test(norm)) add(t, 8, "recurring cost");
  if (/\b(water bill|electricity bill|power bill|light bill|ecg bill)\b/.test(norm)) add(t, 12, "utility bill");
  if (/\b(shop rent|office rent|store rent|space rent|market rent|stall rent|container rent)\b/.test(norm)) add(t, 13, "shop rent");
  if (/\b(insurance|policy premium|premiums?)\b/.test(norm)) add(t, 8, "insurance");
  if (/\b(cleaning|sweeping|security|guard|watchman|night guard)\b/.test(norm)) add(t, 7, "facility cost");
  if (/\b(generator|genset|diesel|petrol|fuel)\b/.test(norm) && /\b(generator|genset|power|filling)\b/.test(norm)) add(t, 9, "generator fuel");
  if (/\b(vehicle|car|motorbike|truck|pickup)\b/.test(norm) && /\b(service|maintenance|repair|fix)\b/.test(norm)) add(t, 8, "vehicle maintenance");
  if (/\b(phone bill|line rent|sim|data for business)\b/.test(norm)) add(t, 7, "phone bill");
  if (/\b(store maintenance|shop maintenance|building maintenance)\b/.test(norm)) add(t, 9, "store maintenance");
  if (/\b(fumigation|spraying|pest control)\b/.test(norm)) add(t, 8, "pest control");
  if (/\b(dstv|gotv|showmax|netflix|satellite)\b/.test(norm)) add(t, 7, "subscription tv");
  if (/\b(refuse|garbage|waste disposal|sanitation|cleaning fee)\b/.test(norm)) add(t, 7, "sanitation");
  if (/\b(ecg token|electricity token|prepaid electricity|power token)\b/.test(norm)) add(t, 12, "ecg token");
  if (/\b(gwcl|ghana water|water token|water bill)\b/.test(norm)) add(t, 11, "water bill");
  if (/\b(regular bill|standing charge|monthly bill)\b/.test(norm)) add(t, 8, "regular bill");
  if (/\b(nedco|volta|volta river|vra power|electricity|light)\b/.test(norm) && /\b(paid|pay|bill)\b/.test(norm)) add(t, 10, "nedco/vra");
  if (/\b(cooler|fridge|freezer)\b/.test(norm) && /\b(rent|hire|lease)\b/.test(norm)) add(t, 8, "equipment rent");
  if (/\b(account fees?|annual charges?|yearly fees?)\b/.test(norm)) add(t, 7, "annual fees");
  if (/\b(cooling system|cold room|cold store)\b/.test(norm) && /\b(paid|bill|charge)\b/.test(norm)) add(t, 8, "cold room");
  if (/\b(pos machine|pos terminal|pos charge)\b/.test(norm)) add(t, 8, "pos charges");
  if (/\b(building|office|shop|store)\b/.test(norm) && /\b(rent|lease|hire)\b/.test(norm)) add(t, 10, "building rent");
  if (/\b(light bill|dumsor|power bill)\b/.test(norm)) add(t, 11, "light bill");
  if (/\b(flat fee|monthly fee|quarterly fee)\b/.test(norm)) add(t, 7, "periodic fee");
  if (/\b(logistics|supply chain|freight|cargo)\b/.test(norm) && /\b(paid|pay)\b/.test(norm)) add(t, 7, "logistics cost");
  if (/\b(renewal|renewed|renew)\b/.test(norm) && /\b(rent|lease|license|permit)\b/.test(norm)) add(t, 8, "renewal");
  if (/\b(accommodation|housing|shop owner|landlord)\b/.test(norm) && /\b(paid|pay)\b/.test(norm)) add(t, 7, "accommodation");
}

// ── SALARY (27 signals) ───────────────────────────────────────────────────────
function runSalaryVotes(norm: string, _raw: string, add: VoteMap["add"]) {
  const t = "salary" as const;
  if (/\b(salary|salaries)\b/.test(norm)) add(t, 14, "salary keyword");
  if (/\b(wages?)\b/.test(norm)) add(t, 13, "wages keyword");
  if (/\b(paid staff|pay staff|staff payment|paid worker|paid employee|employee pay|worker pay)\b/.test(norm)) add(t, 11, "staff paid");
  if (/\b(apprentice|intern|worker|employee|helper|assistant)\b/.test(norm) && /\b(paid|pay)\b/.test(norm)) add(t, 9, "worker paid");
  if (/\b(end of month|monthly pay|weekly pay|daily pay|weekly wage)\b/.test(norm) && GH_NAMES_PATTERN.test(norm)) add(t, 9, "periodic pay + name");
  if (/\b(bonus|allowance|overtime)\b/.test(norm)) add(t, 8, "staff benefit");
  if (/\b(payroll|payslip|pay slip|pay sheet)\b/.test(norm)) add(t, 10, "payroll");
  if (/\b(pay worker|pay apprentice|pay help|pay assistant)\b/.test(norm)) add(t, 10, "pay worker");
  if (/\b(worker money|staff money|workman money|apprentice money)\b/.test(norm)) add(t, 10, "worker money pidgin");
  if (/\b(give worker pay|apprentice pay|staff pay)\b/.test(norm)) add(t, 10, "give worker pay");
  if (/\b(monthly salary|weekly salary|daily wage|per day pay)\b/.test(norm)) add(t, 10, "periodic salary");
  if (/\b(shop assistant|shop girl|shop boy|cashier|barber|hairdresser|nurse)\b/.test(norm) && /\b(paid|pay|salary|wages?)\b/.test(norm)) add(t, 9, "role + paid");
  if (/\b(driver salary|driver pay|driver wages?)\b/.test(norm)) add(t, 10, "driver salary");
  if (/\b(security salary|watchman pay|guard pay)\b/.test(norm)) add(t, 10, "security salary");
  if (/\b(end of week|weekly payment|week payment)\b/.test(norm)) add(t, 7, "end of week");
  if (/\b(staff payroll|workers payroll)\b/.test(norm)) add(t, 10, "staff payroll");
  if (/\b(tips?|tip for|tipped)\b/.test(norm)) add(t, 6, "tips");
  if (/\b(commission for staff|sales commission)\b/.test(norm)) add(t, 8, "staff commission");
  if (/\b(labour cost|labor cost|labor pay)\b/.test(norm)) add(t, 8, "labour cost");
  if (/\b(paid my (staff|worker|helper|apprentice|assistant))\b/.test(norm)) add(t, 11, "paid my worker");
  if (/\b(dem pay worker|pay am|give am money)\b/.test(norm) && /\b(worker|apprentice)\b/.test(norm)) add(t, 9, "pidgin:pay worker");
  if (/\b(mechanic pay|electrician pay|plumber pay|painter pay)\b/.test(norm)) add(t, 8, "artisan pay");
  if (/\b(casual|casual worker|temporary|temp worker)\b/.test(norm) && /\bpaid\b/.test(norm)) add(t, 8, "casual worker");
  if (/\b(monthly end|month end payment|salary day)\b/.test(norm)) add(t, 9, "salary day");
  if (/\b(gave worker|gave staff|gave apprentice)\b/.test(norm) && !/\b(loan|borrow)\b/.test(norm)) add(t, 8, "gave worker money");
  if (/\b(hired worker|new worker|took on worker)\b/.test(norm) && /\b(paid|pay)\b/.test(norm)) add(t, 7, "hired worker paid");
  if (/\b(feeding allowance|transport allowance|housing allowance)\b/.test(norm)) add(t, 8, "allowance types");
}

// ── TAX (27 signals) ──────────────────────────────────────────────────────────
function runTaxVotes(norm: string, _raw: string, add: VoteMap["add"]) {
  const t = "tax" as const;
  if (/\btax\b/.test(norm)) add(t, 13, "tax keyword");
  if (/\b(levy|levies)\b/.test(norm)) add(t, 12, "levy keyword");
  if (GH_AUTHORITY.some((a) => norm.includes(a))) add(t, 11, "authority keyword");
  if (/\b(vat|nhil|getfund|covid levy|e-levy|electronic levy)\b/.test(norm)) add(t, 13, "ghana tax type");
  if (/\b(tithe|church offering|mosque offering|first fruit|thanksgiving)\b/.test(norm)) add(t, 9, "tithe/offering");
  if (/\b(business license|license fee|permit|business permit)\b/.test(norm)) add(t, 9, "license fee");
  if (/\b(stamp duty|withholding tax|income tax|corporate tax)\b/.test(norm)) add(t, 12, "specific tax");
  if (/\b(customs duty|import duty|export duty|excise duty)\b/.test(norm)) add(t, 12, "duty");
  if (/\b(assembly levy|district assembly|municipal levy|local levy)\b/.test(norm)) add(t, 11, "assembly levy");
  if (/\b(vehicle tax|car tax|road tax|motor tax)\b/.test(norm)) add(t, 10, "vehicle tax");
  if (/\b(toll booth|toll road|highway toll)\b/.test(norm)) add(t, 9, "toll");
  if (/\b(government payment|state payment|national service fee)\b/.test(norm)) add(t, 8, "government payment");
  if (/\b(ssnit|pension|provident fund)\b/.test(norm)) add(t, 10, "ssnit/pension");
  if (/\b(market levy|market fee|stall fee|table fee)\b/.test(norm)) add(t, 11, "market levy");
  if (/\b(tax filing|tax return|tax payment|tax office)\b/.test(norm)) add(t, 11, "tax filing");
  if (/\b(gra payment|gra fee|gra charge)\b/.test(norm)) add(t, 12, "gra payment");
  if (/\b(roadworthy|vehicle inspection|vehicle test|mvit)\b/.test(norm)) add(t, 9, "roadworthy");
  if (/\b(drivers license|driving license|renewal license)\b/.test(norm)) add(t, 9, "license");
  if (/\b(registration|business registration|entity registration)\b/.test(norm)) add(t, 8, "registration");
  if (/\b(food and drugs|fda fee|fda levy|fda registration)\b/.test(norm)) add(t, 10, "fda");
  if (/\b(Ghana standards|gsa|standards board)\b/.test(norm)) add(t, 9, "standards board");
  if (/\b(health levy|sanitation levy|environmental levy)\b/.test(norm)) add(t, 9, "health levy");
  if (/\b(council tax|property tax|rate)\b/.test(norm)) add(t, 9, "council tax");
  if (/\b(fire service|fire levy|fire certificate)\b/.test(norm)) add(t, 8, "fire service");
  if (/\b(import charge|import fee|import payment)\b/.test(norm)) add(t, 9, "import charge");
  if (/\b(annual return|year end tax)\b/.test(norm)) add(t, 9, "annual return");
  if (/\b(company tax|personal income tax|pit)\b/.test(norm)) add(t, 11, "pit tax");
}

// ── BORROW IN (27 signals) ────────────────────────────────────────────────────
function runBorrowInVotes(norm: string, _raw: string, add: VoteMap["add"]) {
  const t = "borrow_in" as const;
  if (/\bborrowed from\b/.test(norm)) add(t, 14, "borrowed from");
  if (/\b(took loan|take loan|got loan|received loan|collected loan from)\b/.test(norm)) add(t, 13, "got loan");
  if (/\b(loan from|borrowed from|credit from|advance from)\b/.test(norm)) add(t, 13, "loan from source");
  if (/\b(got advance|received advance|advance payment in)\b/.test(norm)) add(t, 10, "advance received");
  if (/\b(overdraft|bank overdraft|bank loan|bank credit)\b/.test(norm)) add(t, 11, "overdraft/bank loan");
  if (/\bsusu\b/.test(norm) && /\b(got|received|collected|took|won|win)\b/.test(norm)) add(t, 11, "susu win");
  if (/\b(group loan|cooperative loan|nananom loan|rotating fund|pigmy)\b/.test(norm)) add(t, 10, "group loan");
  if (/\bborrowed\b/.test(norm) && !/\bborrowed from me\b/.test(norm) && !/\b(gave|lent)\b/.test(norm)) add(t, 8, "borrowed generic");
  if (/\b(family loan|friend loan|personal loan received|soft loan)\b/.test(norm)) add(t, 10, "personal loan in");
  if (/\b(microfinance|nsoatreman|first allied|letshego|advans|opportunity|capital rural)\b/.test(norm) && /\b(loan|borrow|credit)\b/.test(norm)) add(t, 11, "microfinance loan");
  if (/\b(i borrow|we borrow|take advance|took advance)\b/.test(norm)) add(t, 10, "pidgin:borrow");
  if (/\b(e lend me|dem lend me|they lend|they gave me loan)\b/.test(norm)) add(t, 11, "pidgin:lend me");
  if (/\b(credit facility|line of credit|revolving credit)\b/.test(norm)) add(t, 9, "credit facility");
  if (/\b(borrowing|took borrowing|taking loan)\b/.test(norm)) add(t, 9, "borrowing phrase");
  if (/\b(bank advance|bank gave|bank credited)\b/.test(norm)) add(t, 10, "bank advance");
  if (/\b(loan received|received loan|money received from loan)\b/.test(norm)) add(t, 11, "loan received");
  if (/\b(collected from bank|collected from microfinance)\b/.test(norm)) add(t, 10, "collected from bank");
  if (/\b(borrowed money|loan money|got loan money)\b/.test(norm)) add(t, 9, "borrowed money");
  if (/\b(debt obligation|new debt|new obligation)\b/.test(norm) && /\b(from|bank|friend|family)\b/.test(norm)) add(t, 8, "new obligation");
  if (/\b(quick loan|fast loan|emergency loan|urgent loan)\b/.test(norm)) add(t, 9, "quick loan");
  if (/\b(pigmy|daily savings|daily contribution|susu man)\b/.test(norm) && /\b(collect|received|got)\b/.test(norm)) add(t, 9, "daily savings collect");
  if (/\b(borrowed capital|loan capital|loan for business)\b/.test(norm)) add(t, 10, "business loan");
  if (/\b(startup loan|start up|business started)\b/.test(norm) && /\b(loan|credit|borrow)\b/.test(norm)) add(t, 8, "startup loan");
  if (/\b(promise pay back|will pay back)\b/.test(norm)) add(t, 5, "will pay back");
  if (/\b(new borrowing|fresh loan|additional loan)\b/.test(norm)) add(t, 8, "fresh loan");
  if (/\b(loan from church|church loan|community loan)\b/.test(norm)) add(t, 9, "community loan");
  if (/\b(revolving|rotational|rotating)\b/.test(norm) && /\b(fund|susu|credit|loan)\b/.test(norm)) add(t, 9, "rotating fund");
}

// ── BORROW OUT (27 signals) ───────────────────────────────────────────────────
function runBorrowOutVotes(norm: string, raw: string, add: VoteMap["add"]) {
  const t = "borrow_out" as const;
  if (/\b(gave loan|give loan|gave.*loan)\b/.test(norm)) add(t, 13, "gave loan");
  if (/\b(lent|lend)\b/.test(norm)) add(t, 12, "lent keyword");
  if (/\bborrowed from me\b/.test(norm)) add(t, 14, "borrowed from me");
  if (/\badvanced\b/.test(norm) && GH_NAMES_PATTERN.test(raw)) add(t, 10, "advanced name");
  if (/\bgave\s+\w+\s+money\b/.test(norm)) add(t, 11, "gave name money");
  if (/\b(personal loan given|loan to|gave credit loan)\b/.test(norm)) add(t, 10, "loan to someone");
  if (/\b(susu for|saved for|kept for|collect for)\b/.test(norm) && GH_NAMES_PATTERN.test(raw)) add(t, 8, "susu given");
  if (/\b(e borrow from me|dem borrow from me|they borrow from me)\b/.test(norm)) add(t, 12, "pidgin:borrow from me");
  if (/\b(i give am|i lend am)\b/.test(norm)) add(t, 11, "pidgin:give/lend");
  if (/\b(gave money to|give money to)\b/.test(norm) && GH_NAMES_PATTERN.test(raw)) add(t, 10, "gave money to name");
  if (/\b(extended credit|credit extended|credit given)\b/.test(norm)) add(t, 9, "credit extended");
  if (/\b(loan given|money lent|money loaned)\b/.test(norm)) add(t, 11, "loan given");
  if (/\b(friend needs money|family needs money)\b/.test(norm)) add(t, 7, "friend needs");
  if (/\b(cash lent|cash loan|gave cash)\b/.test(norm)) add(t, 10, "cash lent");
  if (/\b(advance salary|salary advance|wage advance)\b/.test(norm)) add(t, 9, "salary advance");
  if (/\b(informal loan|help money|helping money)\b/.test(norm)) add(t, 8, "informal loan");
  if (/\b(dash am|i dash)\b/.test(norm) && /\b(loan|borrow)\b/.test(norm)) add(t, 8, "dash as loan");
  if (/\b(gave on trust|trust money|gave trust)\b/.test(norm)) add(t, 8, "trust loan");
  if (/\b(float|gave float|shop float)\b/.test(norm)) add(t, 7, "float given");
  if (/\b(they will pay|will pay me back|pay back later)\b/.test(norm)) add(t, 6, "will pay back");
  if (/\b(my money with|money is with|left money with)\b/.test(norm) && GH_NAMES_PATTERN.test(raw)) add(t, 9, "money with name");
  if (/\b(borrowed by|taken by)\b/.test(norm) && GH_NAMES_PATTERN.test(raw)) add(t, 9, "borrowed by name");
  if (/\b(gave assistance|financial assistance|financial help)\b/.test(norm)) add(t, 7, "financial assistance");
  if (/\b(lending out|lending money|money out on loan)\b/.test(norm)) add(t, 10, "lending out");
  if (/\b(soft loan given|low interest|no interest)\b/.test(norm)) add(t, 8, "soft loan given");
  if (/\b(gave advance|advance given|advance to)\b/.test(norm)) add(t, 9, "advance given");
  if (/\b(partner loan|business partner loan)\b/.test(norm)) add(t, 8, "partner loan");
}

// ── LOAN REPAY OUT (25 signals) ───────────────────────────────────────────────
function runLoanRepayOutVotes(norm: string, _raw: string, add: VoteMap["add"]) {
  const t = "loan_repay_out" as const;
  if (/\b(paid back loan|paid loan|repaid loan|returned loan|cleared loan)\b/.test(norm)) add(t, 14, "paid loan");
  if (/\b(loan repayment|loan payment|monthly loan|loan installment)\b/.test(norm)) add(t, 12, "loan repayment");
  if (/\b(bank deducted|bank took|bank charge|bank deduction|auto debit)\b/.test(norm)) add(t, 11, "bank deduction");
  if (/\brepaid\b/.test(norm) && /\b(bank|loan|borrow|susu|group|microfinance)\b/.test(norm)) add(t, 11, "repaid + context");
  if (/\b(settled loan|cleared borrowing|paid off loan|finished paying loan)\b/.test(norm)) add(t, 12, "settled loan");
  if (/\b(instalment|installment payment|monthly instalment)\b/.test(norm)) add(t, 9, "instalment");
  if (/\b(owe bank|paying back|repaying|paying back bank)\b/.test(norm)) add(t, 8, "paying back bank");
  if (/\b(susu payment|paying susu|susu contribution)\b/.test(norm)) add(t, 10, "susu payment");
  if (/\b(loan due|overdue loan|loan matured)\b/.test(norm)) add(t, 9, "loan due");
  if (/\b(reducing loan|reduce loan balance|pay down loan)\b/.test(norm)) add(t, 9, "reducing loan");
  if (/\b(weekly loan|fortnightly payment|bi-weekly payment)\b/.test(norm)) add(t, 8, "periodic loan pay");
  if (/\b(i go pay|i pay bank|pay back loan now)\b/.test(norm)) add(t, 9, "pidgin:pay loan");
  if (/\b(returned money to|gave back money to)\b/.test(norm) && /\b(bank|microfinance|lender|friend)\b/.test(norm)) add(t, 9, "returned to lender");
  if (/\b(cleared my debt|paid my debt|paid what i owe)\b/.test(norm)) add(t, 9, "cleared my debt");
  if (/\b(first payment|second payment|third payment)\b/.test(norm) && /\b(loan|borrow)\b/.test(norm)) add(t, 8, "nth payment on loan");
  if (/\b(loan clearing|loan offset|loan writeoff)\b/.test(norm)) add(t, 9, "loan clearing");
  if (/\b(capital payment|principal payment)\b/.test(norm)) add(t, 9, "principal payment");
  if (/\b(interest payment|interest on loan|loan interest)\b/.test(norm)) add(t, 9, "interest payment");
  if (/\b(owed money now paid|i owed now paid)\b/.test(norm)) add(t, 10, "owed now paid");
  if (/\b(advance recovered|advance payment return)\b/.test(norm)) add(t, 8, "advance recovered");
  if (/\b(microfinance payment|microfinance installment)\b/.test(norm)) add(t, 10, "microfinance payment");
  if (/\b(deducted from account|account deducted|debit from account)\b/.test(norm)) add(t, 9, "account deduction");
  if (/\b(co-op payment|cooperative payment|nananom payment)\b/.test(norm)) add(t, 9, "co-op payment");
  if (/\b(full loan|full repayment|complete loan payment)\b/.test(norm)) add(t, 10, "full loan repayment");
  if (/\b(partial loan|partial repayment)\b/.test(norm)) add(t, 8, "partial loan");
}

// ── LOAN COLLECT IN (24 signals) ─────────────────────────────────────────────
function runLoanCollectInVotes(norm: string, _raw: string, add: VoteMap["add"]) {
  const t = "loan_collect_in" as const;
  if (/\b(collected loan|recovered loan|got back my money|got my money back)\b/.test(norm)) add(t, 14, "collected loan");
  if (/\b(returned my money|gave me back|paid me back.*loan)\b/.test(norm)) add(t, 12, "returned my money");
  if (/\b(loan recovered|loan collected|money recovered)\b/.test(norm)) add(t, 11, "loan recovered");
  if (/\b(recovered from|collected from)\b/.test(norm) && !/\b(stock|goods|sales|customer|debt)\b/.test(norm)) add(t, 9, "recovered from");
  if (GH_NAMES_PATTERN.test(norm) && /\b(returned|gave back|paid back|returned.*loan|paid.*loan)\b/.test(norm)) add(t, 11, "name returned money");
  if (/\b(got back the loan|got loan money back|loan money returned)\b/.test(norm)) add(t, 11, "got loan back");
  if (/\b(friend returned|family returned|he returned|she returned)\b/.test(norm) && !/\b(goods|item|product)\b/.test(norm)) add(t, 10, "someone returned money");
  if (/\b(loan cleared by|loan paid by)\b/.test(norm)) add(t, 10, "loan cleared by");
  if (/\b(repaid me|repaid my|settled me|settled my loan)\b/.test(norm)) add(t, 11, "repaid me");
  if (/\b(e pay me back|dem pay me back|e return my money)\b/.test(norm)) add(t, 11, "pidgin:pay me back");
  if (/\b(my money is back|money came back|money returned to me)\b/.test(norm)) add(t, 10, "money came back");
  if (/\b(finally returned|eventually paid|finally paid me)\b/.test(norm)) add(t, 9, "finally returned");
  if (/\b(susu collected|susu received|got my susu)\b/.test(norm)) add(t, 10, "susu collected");
  if (/\b(got back my advance|advance returned|advance paid back)\b/.test(norm)) add(t, 10, "advance returned");
  if (/\b(collected installment|received installment|got installment)\b/.test(norm)) add(t, 9, "installment received");
  if (/\b(recovering loan|collecting outstanding|collecting my money)\b/.test(norm)) add(t, 9, "recovering");
  if (/\b(debt recovery|loan recovery)\b/.test(norm) && /\b(success|received|collected|got)\b/.test(norm)) add(t, 9, "debt recovery success");
  if (/\b(cash recovered|cash returned|physical return)\b/.test(norm)) add(t, 8, "cash recovered");
  if (/\b(i collect|e collect for me)\b/.test(norm) && !/\b(stock|goods|market|susu win)\b/.test(norm)) add(t, 8, "pidgin:collect");
  if (/\b(received back|received repayment|got repayment)\b/.test(norm)) add(t, 9, "received back");
  if (/\b(payback|pay-back|pay back to me)\b/.test(norm)) add(t, 8, "payback");
  if (/\b(loan income|loan collection income)\b/.test(norm)) add(t, 8, "loan income");
  if (/\b(friend pay back|bro pay|sis pay)\b/.test(norm)) add(t, 8, "informal payback");
  if (/\b(micro loan collected|micro loan received)\b/.test(norm)) add(t, 9, "micro loan collected");
}

// ── INVESTMENT (24 signals) ───────────────────────────────────────────────────
function runInvestmentVotes(norm: string, _raw: string, add: VoteMap["add"]) {
  const t = "investment" as const;
  if (/\b(invested|invest)\b/.test(norm)) add(t, 13, "invest");
  if (/\b(capital injection|capital added|put capital|added capital)\b/.test(norm)) add(t, 13, "capital injection");
  if (/\b(put money into|money into business|business capital|startup money)\b/.test(norm)) add(t, 11, "money into business");
  if (/\b(funded|funding|seed money|angel|angel investor)\b/.test(norm)) add(t, 10, "funding");
  if (/\b(equity|shares?|shareholder|contribution)\b/.test(norm)) add(t, 9, "equity");
  if (/\b(added funds|injected|injection|fresh funds)\b/.test(norm)) add(t, 10, "injection");
  if (/\b(owner investment|owner capital|personal capital|my own money)\b/.test(norm) && /\b(put|invest|add)\b/.test(norm)) add(t, 10, "owner capital");
  if (/\b(start up capital|startup capital|business start)\b/.test(norm)) add(t, 10, "startup capital");
  if (/\b(i invest|we invest|i put money)\b/.test(norm)) add(t, 10, "i invest");
  if (/\b(new business|expand business|growing business)\b/.test(norm) && /\b(invest|capital|fund|money)\b/.test(norm)) add(t, 8, "business growth");
  if (/\b(added to business|money to business|business injection)\b/.test(norm)) add(t, 9, "added to business");
  if (/\b(own money|personal money|savings into business|used savings)\b/.test(norm) && /\b(invest|add|put)\b/.test(norm)) add(t, 8, "savings invested");
  if (/\b(new capital|more capital|capital increase)\b/.test(norm)) add(t, 9, "capital increase");
  if (/\b(reinvest|re-invest|ploughed back)\b/.test(norm)) add(t, 10, "reinvest");
  if (/\b(shareholder fund|director loan|director capital)\b/.test(norm)) add(t, 9, "director fund");
  if (/\b(grant|government grant|business grant|ngo grant)\b/.test(norm)) add(t, 9, "grant received");
  if (/\b(gift to business|donation to business)\b/.test(norm)) add(t, 7, "gift to business");
  if (/\b(asset purchase|equipment purchase|machinery purchase)\b/.test(norm)) add(t, 7, "asset purchase");
  if (/\b(bought asset|bought property|bought equipment)\b/.test(norm)) add(t, 7, "bought asset");
  if (/\b(diaspora money|remittance|overseas money)\b/.test(norm) && /\b(invest|capital|business)\b/.test(norm)) add(t, 9, "diaspora investment");
  if (/\b(bank savings|savings account|withdrew savings for business)\b/.test(norm)) add(t, 7, "savings to business");
  if (/\b(money market|treasury bill|t-bill)\b/.test(norm) && /\b(invest|put)\b/.test(norm)) add(t, 8, "financial investment");
  if (/\b(land|property|building)\b/.test(norm) && /\b(bought|purchased|invest)\b/.test(norm)) add(t, 6, "property investment");
  if (/\b(first capital|initial capital|founding capital)\b/.test(norm)) add(t, 10, "founding capital");
}

// ── WITHDRAWAL (24 signals) ───────────────────────────────────────────────────
function runWithdrawalVotes(norm: string, _raw: string, add: VoteMap["add"]) {
  const t = "withdrawal" as const;
  if (/\b(withdrew|withdrawal)\b/.test(norm)) add(t, 13, "withdrawal");
  if (/\b(took for personal|personal use|owner took|owner draw|owner withdrawal)\b/.test(norm)) add(t, 12, "personal withdrawal");
  if (/\b(took from business|withdrew from business|took out of business)\b/.test(norm)) add(t, 11, "from business");
  if (/\b(dividend|drawings?|proprietor drawing)\b/.test(norm)) add(t, 10, "drawing");
  if (/\b(home money|family money|personal money|house money)\b/.test(norm)) add(t, 8, "home money");
  if (/\b(took for home|sent home|gave family|sent to family)\b/.test(norm)) add(t, 9, "family money");
  if (/\b(personal expenses?|private expenses?|own use)\b/.test(norm)) add(t, 8, "personal expenses");
  if (/\b(i take|took money|i took)\b/.test(norm) && /\b(personal|home|family|myself|myself)\b/.test(norm)) add(t, 8, "i took for personal");
  if (/\b(took profit|taking profit|took earnings)\b/.test(norm)) add(t, 9, "took profit");
  if (/\b(owner salary|self salary|paying myself)\b/.test(norm)) add(t, 9, "owner salary");
  if (/\b(cash out|cashed out|took cash)\b/.test(norm) && /\b(personal|myself|home)\b/.test(norm)) add(t, 9, "cash out personal");
  if (/\b(i draw|drawing from business)\b/.test(norm)) add(t, 10, "drawing from business");
  if (/\b(business money for home|shop money for personal)\b/.test(norm)) add(t, 10, "shop money personal");
  if (/\b(transferred to self|sent to myself|to my account)\b/.test(norm) && !/\b(savings|investment)\b/.test(norm)) add(t, 8, "to myself");
  if (/\b(took for rent|took for food|took for school)\b/.test(norm)) add(t, 7, "took for specific");
  if (/\b(reducing capital|reducing investment|removed capital)\b/.test(norm)) add(t, 8, "reducing capital");
  if (/\b(owner.?s take|owner.?s cut)\b/.test(norm)) add(t, 9, "owner's cut");
  if (/\b(temporary withdrawal|short term|borrowed from business)\b/.test(norm)) add(t, 7, "temp withdrawal");
  if (/\b(advance for owner|owner advance)\b/.test(norm)) add(t, 9, "owner advance");
  if (/\b(took from till|till money|till withdrawal)\b/.test(norm)) add(t, 9, "till withdrawal");
  if (/\b(cash for self|personal cash|my cash)\b/.test(norm)) add(t, 8, "personal cash");
  if (/\b(end of day withdrawal|daily withdrawal)\b/.test(norm)) add(t, 8, "daily withdrawal");
  if (/\b(keeping aside|put aside|set aside)\b/.test(norm) && /\b(personal|myself|home)\b/.test(norm)) add(t, 7, "set aside personal");
  if (/\b(owner expense|proprietor expense|director expense)\b/.test(norm)) add(t, 9, "owner expense");
}

// ── REFUND OUT (22 signals) ───────────────────────────────────────────────────
function runRefundOutVotes(norm: string, raw: string, add: VoteMap["add"]) {
  const t = "refund_out" as const;
  if (/\b(refunded customer|customer refund|gave refund)\b/.test(norm)) add(t, 13, "customer refund");
  if (/\b(gave back money|returned money to customer|money back to)\b/.test(norm)) add(t, 11, "gave back money");
  if (/\brefund\b/.test(norm) && GH_NAMES_PATTERN.test(raw)) add(t, 10, "refund + name");
  if (/\b(complaint refund|product return refund|return money)\b/.test(norm)) add(t, 9, "complaint refund");
  if (/\b(customer returned|customer complaint|unhappy customer|dissatisfied)\b/.test(norm) && /\b(paid|refund|money)\b/.test(norm)) add(t, 9, "unhappy customer");
  if (/\b(overcharged|wrong price|price error)\b/.test(norm) && /\b(refund|paid back|gave back)\b/.test(norm)) add(t, 9, "overcharge refund");
  if (/\b(refund for bad goods|bad product refund|faulty refund)\b/.test(norm)) add(t, 10, "bad goods refund");
  if (/\b(give back|give it back|give change)\b/.test(norm) && GH_NAMES_PATTERN.test(raw)) add(t, 7, "give back + name");
  if (/\b(wrong payment|error payment|paid twice|double payment)\b/.test(norm)) add(t, 9, "error payment");
  if (/\b(return for customer|returned customer.?s money)\b/.test(norm)) add(t, 10, "returned customer money");
  if (/\b(money back guarantee|satisfaction guarantee)\b/.test(norm)) add(t, 8, "money back guarantee");
  if (/\b(gave change back|extra change)\b/.test(norm)) add(t, 7, "extra change");
  if (/\b(cancelled order|order cancelled|cancel sale)\b/.test(norm)) add(t, 8, "cancelled order");
  if (/\b(gave discount|price reduction|discount applied)\b/.test(norm)) add(t, 6, "discount");
  if (/\b(exchange refund|swap refund)\b/.test(norm)) add(t, 8, "exchange refund");
  if (/\b(paid back customer|customer paid back)\b/.test(norm)) add(t, 10, "paid back customer");
  if (/\b(returned the money|returned cash)\b/.test(norm) && GH_NAMES_PATTERN.test(raw)) add(t, 9, "returned cash + name");
  if (/\b(gave money back to|give money back to)\b/.test(norm)) add(t, 10, "gave money back to");
  if (/\b(reversed transaction|reversed sale|sale reversal)\b/.test(norm)) add(t, 9, "reversed sale");
  if (/\b(customer not happy|not satisfied|returned goods)\b/.test(norm) && /\b(refund|money|cash)\b/.test(norm)) add(t, 8, "returned goods + refund");
  if (/\b(refund momo|momo refund|momo back)\b/.test(norm)) add(t, 9, "momo refund");
  if (/\b(i refund|we refund|had to refund)\b/.test(norm)) add(t, 10, "i refund");
}

// ── REFUND IN (22 signals) ────────────────────────────────────────────────────
function runRefundInVotes(norm: string, _raw: string, add: VoteMap["add"]) {
  const t = "refund_in" as const;
  if (/\b(supplier refund|got refund from supplier|supplier gave back)\b/.test(norm)) add(t, 13, "supplier refund");
  if (/\b(credit note|got credit note|supplier credit)\b/.test(norm)) add(t, 12, "credit note");
  if (/\b(returned goods.*refund|supplier returned money)\b/.test(norm)) add(t, 11, "supplier returned");
  if (/\b(got my money back|they refunded|refund received)\b/.test(norm)) add(t, 10, "refund received");
  if (/\b(insurance claim|insurance payout|compensation received|claim paid)\b/.test(norm)) add(t, 10, "insurance claim");
  if (/\b(returned to supplier|returned stock|supplier took back)\b/.test(norm) && /\b(refund|money|cash)\b/.test(norm)) add(t, 10, "returned to supplier refund");
  if (/\b(overcharged by supplier|supplier error|wrong invoice)\b/.test(norm) && /\b(refund|paid back|gave back)\b/.test(norm)) add(t, 9, "supplier overcharge");
  if (/\b(bank reversed|bank refunded|bank error refund)\b/.test(norm)) add(t, 10, "bank refund");
  if (/\b(damaged goods refund|bad goods from supplier)\b/.test(norm)) add(t, 10, "damaged goods refund");
  if (/\b(excess payment returned|overpaid returned)\b/.test(norm)) add(t, 9, "overpayment returned");
  if (/\b(momo reversed|momo refund received|reversal received)\b/.test(norm)) add(t, 10, "momo reversed");
  if (/\b(tax refund|vat refund|duty refund)\b/.test(norm)) add(t, 10, "tax refund");
  if (/\b(government refund|assembly refund|council refund)\b/.test(norm)) add(t, 9, "govt refund");
  if (/\b(they refunded me|supplier credited me)\b/.test(norm)) add(t, 10, "supplier credited me");
  if (/\b(warranty claim|warranty refund|exchange refund in)\b/.test(norm)) add(t, 9, "warranty claim");
  if (/\b(cost of return|return cash|cash return)\b/.test(norm) && /\b(from supplier|from vendor)\b/.test(norm)) add(t, 9, "return cash from supplier");
  if (/\b(got compensation|received compensation)\b/.test(norm)) add(t, 9, "compensation");
  if (/\b(received refund|refund received|got refund)\b/.test(norm)) add(t, 10, "received refund");
  if (/\b(money from insurance|insurance money|claim money)\b/.test(norm)) add(t, 9, "insurance money");
  if (/\b(supplier discount|trade discount|volume discount)\b/.test(norm) && /\b(received|got|credited)\b/.test(norm)) add(t, 8, "trade discount");
  if (/\b(partial refund|some money back|got some back)\b/.test(norm)) add(t, 8, "partial refund");
  if (/\b(they paid me back the wrong)\b/.test(norm)) add(t, 8, "wrong payment refund");
}

// ── TRANSFER (22 signals) ─────────────────────────────────────────────────────
function runTransferVotes(norm: string, _raw: string, add: VoteMap["add"]) {
  const t = "transfer" as const;
  if (/\b(transferred|transfer)\b/.test(norm) && /\b(from|to)\b/.test(norm)) add(t, 13, "transfer from/to");
  if (/\b(momo to bank|bank to cash|cash to momo|momo to cash|bank to momo)\b/.test(norm)) add(t, 14, "account move");
  if (/\b(between accounts?|account to account)\b/.test(norm)) add(t, 12, "between accounts");
  if (/\b(send money|sent money)\b/.test(norm) && /\b(account|momo|bank|transfer)\b/.test(norm)) add(t, 11, "sent to account");
  if (/\b(float|merchant float|momo float|top up float|load float)\b/.test(norm)) add(t, 10, "momo float");
  if (/\b(move money|moved money|moving money)\b/.test(norm)) add(t, 10, "move money");
  if (/\b(from bank account|bank to wallet|wallet to bank)\b/.test(norm)) add(t, 11, "bank-wallet");
  if (/\b(internal transfer|self transfer|own account)\b/.test(norm)) add(t, 11, "internal transfer");
  if (/\b(cash deposit|deposited cash|put in bank|bank deposit)\b/.test(norm)) add(t, 10, "bank deposit");
  if (/\b(cash withdrawal from bank|withdrew from bank)\b/.test(norm)) add(t, 10, "bank withdrawal");
  if (/\b(mtn float|telecel float|airteltigo float)\b/.test(norm)) add(t, 10, "momo float brand");
  if (/\b(sent to account|sending to account)\b/.test(norm)) add(t, 9, "sent to account");
  if (/\b(cash to bank|bank to cash)\b/.test(norm)) add(t, 11, "cash-bank");
  if (/\b(interbank transfer|intrabank transfer)\b/.test(norm)) add(t, 10, "interbank");
  if (/\b(ghipss|instant pay|mobile banking)\b/.test(norm)) add(t, 9, "ghipss/mobile banking");
  if (/\b(moved from account|moved to account)\b/.test(norm)) add(t, 10, "account move phrase");
  if (/\b(no profit no loss|neutral|no change)\b/.test(norm)) add(t, 7, "neutral");
  if (/\b(reallocate|rebalance|moving funds)\b/.test(norm)) add(t, 8, "reallocate");
  if (/\b(merchant account|pay into merchant)\b/.test(norm)) add(t, 9, "merchant account");
  if (/\b(remit|remitted|sent abroad|diaspora transfer)\b/.test(norm) && !/\b(invest|capital|business)\b/.test(norm)) add(t, 8, "remittance");
  if (/\b(crypto|bitcoin|usdt)\b/.test(norm) && /\b(transfer|send|move)\b/.test(norm)) add(t, 8, "crypto transfer");
  if (/\b(cross border|international transfer|forex)\b/.test(norm)) add(t, 8, "international");
}

// ── TWI / PIDGIN (bonus boost detector) ──────────────────────────────────────
function runTwiPidginVotes(norm: string, _raw: string, add: VoteMap["add"]) {
  // Boost existing votes using local language patterns
  if (/\b(ton|tonton|mi ton|i ton|a ton|e ton)\b/.test(norm)) add("sale", 9, "twi:sell");
  if (/\b(gye sika|gye|got money|sika ba)\b/.test(norm)) add("sale", 7, "twi:receive money");
  if (/\b(mi to|i to|we to|bɔ|boo|cost boo)\b/.test(norm)) add("stock_purchase", 7, "twi:buy");
  if (/\b(kyɛ|kye|kyε)\b/.test(norm)) add("debt", 9, "twi:credit");
  if (/\b(kudi|ego|kɔb|koboo)\b/.test(norm)) add("expense", 5, "hausa/igbo:money");
  if (/\b(pa sika|pay sika|pa me)\b/.test(norm)) add("repayment", 9, "twi:pay me");
  if (GH_TWI_PIDGIN.some((p) => norm.includes(p))) {
    // Check which type each pidgin phrase supports
    const n = norm;
    if (/\b(ton|tonton|sell am|i sell)\b/.test(n)) add("sale", 6, "pidgin/twi boost:sale");
    if (/\b(e don pay|dem pay|e pay me|dem don pay)\b/.test(n)) add("repayment", 8, "pidgin boost:repayment");
    if (/\b(e no pay|dem no pay|dem owe|e owe)\b/.test(n)) add("debt", 8, "pidgin boost:debt");
    if (/\b(i buy|dem buy|they buy)\b/.test(n) && !/\b(sell|ton)\b/.test(n)) add("stock_purchase", 6, "pidgin boost:buy");
    if (/\b(i borrow|e take loan|i take loan)\b/.test(n)) add("borrow_in", 7, "pidgin boost:borrow in");
    if (/\b(i give am|e borrow from me|dem borrow from me)\b/.test(n)) add("borrow_out", 7, "pidgin boost:borrow out");
    if (/\b(pay worker|worker money|staff money|apprentice money)\b/.test(n)) add("salary", 7, "pidgin boost:salary");
    if (/\b(e don clear|dem don clear|e settle)\b/.test(n)) add("repayment", 7, "pidgin boost:cleared");
    if (/\b(i dash am|na credit|give am credit)\b/.test(n)) add("debt", 6, "pidgin boost:credit");
    if (/\b(dem pay me back|e return my money)\b/.test(n)) add("loan_collect_in", 7, "pidgin boost:collect");
    if (/\b(i spend|i pay|i spent)\b/.test(n)) add("expense", 6, "pidgin boost:expense");
    if (/\b(i go buy goods|goods don come|goods arrive)\b/.test(n)) add("stock_purchase", 7, "pidgin boost:stock");
  }
}

// ─── 12. ENTITY EXTRACTION ───────────────────────────────────────────────────
function extractCounterparty(raw: string, norm: string, type: TransactionType): string | null {
  switch (type) {
    case "debt": {
      const m = raw.match(/^(.+?)\s+(?:owes?|owe|credit|borrowed|borrowed from me|give on credit)\b/i);
      return compactName(m?.[1]) || extractNameAfterPrep(norm, "to");
    }
    case "repayment": {
      const m = raw.match(/^(.+?)\s+paid\b/i);
      const name = compactName(m?.[1]);
      if (name && GH_NAMES_PATTERN.test(name)) return name;
      return extractGhanaianName(raw) || extractNameAfterPrep(norm, "from");
    }
    case "borrow_in":
    case "loan_repay_out":
      return extractNameAfterPrep(norm, "from") || extractNameAfterPrep(norm, "to") || extractGhanaianName(raw);
    case "borrow_out":
    case "loan_collect_in": {
      const gaveM = raw.match(/\b(?:gave|lent|advanced|loaned|borrowed to)\s+([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?)\b/);
      if (gaveM) return compactName(gaveM[1]);
      return extractNameAfterPrep(norm, "to") || extractNameAfterPrep(norm, "from") || extractGhanaianName(raw);
    }
    case "salary": {
      const salM = raw.match(/(?:salary|wages?|pay)\s+([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?)/i);
      if (salM) return compactName(salM[1]);
      const paidM = raw.match(/paid\s+([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?)\s+(?:salary|wages?|his|her)/i);
      if (paidM) return compactName(paidM[1]);
      return extractGhanaianName(raw) || extractNameAfterPrep(norm, "to");
    }
    case "refund_out":
      return extractGhanaianName(raw) || extractNameAfterPrep(norm, "to");
    default:
      return extractNameAfterPrep(norm, "from") || extractNameAfterPrep(norm, "to") || null;
  }
}

function extractNameAfterPrep(norm: string, prep: string): string | null {
  const re = new RegExp(`\\b${prep}\\s+([a-z][a-z'\\-]{1,22}(?:\\s+[a-z][a-z'\\-]{1,22})?)\\b`, "i");
  const m = norm.match(re);
  if (!m) return null;
  const candidate = m[1].trim();
  if (/\b(momo|bank|cash|account|shop|business|stock|store|market|supplier|customer|me|my|the|a|an|loan|borrow)\b/i.test(candidate)) return null;
  return compactName(candidate);
}

function extractGhanaianName(raw: string): string | null {
  const m = raw.match(GH_NAMES_PATTERN);
  return m ? compactName(m[0]) : null;
}

function extractProduct(raw: string, norm: string, type: TransactionType, customer?: string | null): string | null {
  if (["borrow_in", "borrow_out", "loan_repay_out", "loan_collect_in", "investment", "withdrawal", "transfer"].includes(type)) return null;
  if (type === "salary" || type === "tax") return null;

  let cleaned = raw
    .replace(/(?:ghs|gh₵|₵|gscur|cedis?)?\s*\d+(?:[,.]?\d+)?(?:\s*k)?\b/gi, " ")
    .replace(/\b(?:\d+\s*)?(?:pcs?|pieces?|bags?|cartons?|crates?|packs?|bottles?|units?|rolls?|tins?|sachets?|cups?|litres?|kilos?|grams?|dozens?|boxes?|bundles?|trays?|flats?|sets?|tubs?|jars?|cans?)\b/gi, " ")
    .replace(/\bgscur\b/gi, " ")
    .replace(/\b(?:sold|sell|sales?|paid|pay|bought|buy|spent|received|collected|stock|restock|expense|expenses?|cash|momo|bank|transfer|from|to|for|the|a|an|my|me|on|credit|wholesale|supplier|vendor|salary|wages?|tax|levy|rent|loan|borrow|withdrew|invest|refund|lent|advance|was|is|has)\b/gi, " ");
  if (customer) cleaned = cleaned.replace(new RegExp(customer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");

  const product = compactName(cleaned);

  if (!product) {
    if (GH_UTILITIES.some((u) => norm.includes(u))) {
      if (norm.includes("ecg") || norm.includes("electricity") || norm.includes("light")) return "ECG electricity";
      if (norm.includes("water") || norm.includes("gwcl")) return "Water bill";
      return "Utility bill";
    }
    if (type === "stock_purchase") return "Goods / stock";
    if (type === "cost") return "Business cost";
  }

  if (product && product.length <= 1) return null;
  return product ?? null;
}

// ─── 13. CATEGORY MAP (55+ entries) ──────────────────────────────────────────
const CATEGORY_MAP: Record<string, string> = {
  ecg: "Electricity", electricity: "Electricity", gwcl: "Water", water: "Water",
  nedco: "Electricity", vra: "Electricity", "light bill": "Electricity",
  "water bill": "Water", "electric bill": "Electricity", "power bill": "Electricity",
  "ecg token": "Electricity", "electricity token": "Electricity",
  rent: "Rent", "shop rent": "Rent", "store rent": "Rent", "stall rent": "Rent",
  "market rent": "Rent", "office rent": "Rent", "container rent": "Rent",
  fuel: "Transport", transport: "Transport", "tro tro": "Transport", taxi: "Transport",
  uber: "Transport", bolt: "Transport", lorry: "Transport", "lorry fare": "Transport",
  "bus fare": "Transport", fare: "Transport",
  salary: "Staff wages", wages: "Staff wages", payroll: "Staff wages",
  "paid staff": "Staff wages", "paid worker": "Staff wages", bonus: "Staff wages",
  allowance: "Staff wages", overtime: "Staff wages", "labour cost": "Staff wages",
  tax: "Tax & levy", levy: "Tax & levy", gra: "Tax & levy", customs: "Tax & levy",
  vat: "Tax & levy", nhil: "Tax & levy", tithe: "Tithe/Offering",
  "church offering": "Tithe/Offering", toll: "Tax & levy", ssnit: "Pension/SSNIT",
  stock: "Stock & goods", restock: "Stock & goods", wholesale: "Stock & goods",
  goods: "Stock & goods", merchandise: "Stock & goods", inventory: "Stock & goods",
  internet: "Business running costs", wifi: "Business running costs",
  subscription: "Business running costs", insurance: "Insurance",
  security: "Business running costs", cleaning: "Business running costs",
  maintenance: "Maintenance & repairs", repair: "Maintenance & repairs",
  generator: "Generator & fuel", diesel: "Generator & fuel",
  loan: "Borrowing & loans", borrowed: "Borrowing & loans", borrow: "Borrowing & loans",
  lent: "Lending", advance: "Lending",
  invested: "Business investment", investment: "Business investment",
  capital: "Business investment", withdrew: "Owner drawing", withdrawal: "Owner drawing",
  refund: "Refunds", "customer refund": "Refunds", "supplier refund": "Refunds",
  transfer: "Money transfer", momo: "Mobile money", bank: "Banking",
  "mobile money": "Mobile money", "momo transfer": "Mobile money",
  advertising: "Marketing", advert: "Marketing", flyer: "Marketing",
  medical: "Medical", hospital: "Medical", clinic: "Medical",
  miscellaneous: "Miscellaneous", misc: "Miscellaneous", petty: "Petty cash",
  sundry: "Miscellaneous", "petty cash": "Petty cash",
};

function detectCategory(norm: string, type: TransactionType): string {
  for (const [keyword, category] of Object.entries(CATEGORY_MAP)) {
    if (norm.includes(keyword)) return category;
  }
  const defaults: Partial<Record<TransactionType, string>> = {
    sale: "Sales income", expense: "General spending", debt: "Customer credit",
    repayment: "Debt collection", stock_purchase: "Stock & goods",
    cost: "Business running costs", salary: "Staff wages", tax: "Tax & levy",
    borrow_in: "Borrowing & loans", borrow_out: "Lending",
    loan_repay_out: "Borrowing & loans", loan_collect_in: "Lending",
    investment: "Business investment", withdrawal: "Owner drawing",
    refund_out: "Refunds", refund_in: "Refunds", transfer: "Money transfer",
  };
  return defaults[type] ?? "General";
}

// ─── 14. CONFIDENCE SCORING ───────────────────────────────────────────────────
function computeConfidence(input: {
  amount: number;
  type: TransactionType;
  productName?: string | null;
  customerName?: string | null;
  paymentMethod: PaymentMethod;
  score: number;
  signals: string[];
}): number {
  let c = 0.30;

  // Amount present is the strongest single signal
  if (input.amount > 0) c += 0.25;

  // Vote-engine score tiers
  if (input.score >= 20)      c += 0.26; // very high — multiple strong signals agree
  else if (input.score >= 14) c += 0.22;
  else if (input.score >= 10) c += 0.16;
  else if (input.score >= 6)  c += 0.10;
  else if (input.score >= 2)  c += 0.05;

  // Supporting entity extraction
  if (input.productName)  c += 0.10;
  if (input.customerName) c += 0.08;

  // Payment method is explicit — user said "momo", "bank", or "cash"
  if (input.paymentMethod !== "unknown") c += 0.06;

  // Signal diversity (number of independent matching patterns)
  if (input.signals.length >= 5) c += 0.05;
  else if (input.signals.length >= 3) c += 0.03;

  // Penalise: amount=0 with no product or customer is almost certainly wrong
  if (input.amount === 0 && !input.productName && !input.customerName) c -= 0.10;

  // Penalise: score ≤ 0 means the type is a last-resort guess
  if (input.score <= 0) c -= 0.08;

  return Math.min(0.99, Math.max(0.10, Number(c.toFixed(2))));
}

// ─── 15. EMPTY PARSE RESULT ──────────────────────────────────────────────────
function emptyParsed(): ParsedTransaction {
  return {
    type: "expense",
    amount: 0,
    quantity: null,
    productName: null,
    customerName: null,
    customerNameNormalized: null,
    category: "Unknown",
    paymentMethod: "unknown",
    notes: "",
    confidence: 0.10,
    currency: "GHS, Cedis",
    syncStatus: "pending",
    parserSignals: [],
  };
}

// ─── 16. DUPLICATE DETECTION ──────────────────────────────────────────────────
/**
 * Returns a stable fingerprint for deduplication.
 * Two messages with the same fingerprint within a short time window
 * should be treated as accidental duplicates.
 *
 * The fingerprint is: normalised text (lowercased, whitespace-collapsed, punctuation stripped).
 * Callers should also check a time window (e.g. < 60 seconds apart).
 */
export function getTransactionFingerprint(rawText: string): string {
  return rawText
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns true when `candidate` is a likely duplicate of any item in `recentFingerprints`.
 * Pass the fingerprints of the last ~10 transactions for the session.
 */
export function isDuplicateTransaction(
  candidate: string,
  recentFingerprints: string[]
): boolean {
  const fp = getTransactionFingerprint(candidate);
  return recentFingerprints.some((r) => r === fp);
}
