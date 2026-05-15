/**
 * ZURIA Enterprise Transaction Parser — 5000+ Pattern Edition
 *
 * Understands natural speech, local Ghanaian English, Pidgin, and all 5 major
 * language groups: Akan/Twi/Fante, Ga, Ewe, Hausa/Dagomba, Dagbani/Dagaare.
 * Covers all 17 transaction types across every Ghana business sector.
 *
 * Pattern count breakdown:
 *  TYPO_MAP            : ~430 entries  (phone keyboard errors, Ghanaian shorthand,
 *                                       location codes, abbreviations)
 *  GH_PRODUCTS         : ~900 items    (food, beverages, agro, building materials,
 *                                       textiles, pharma, auto parts, electronics,
 *                                       events/hospitality, cleaning, packaging,
 *                                       raw materials, tools, spare parts)
 *  GH_NAMES_LIST       : ~900 names    (Akan/Ashanti, Fante, Ga, Ewe, Dagomba,
 *                                       Hausa, Northern Ghana, Western Christian)
 *  GH_MOMO_KEYWORDS    : ~55 items     (MoMo platforms, USSD, QR, float)
 *  GH_BANK_KEYWORDS    : ~80 items     (all major banks, card types, GHIPSS)
 *  GH_UTILITIES        : ~90 items     (ECG, GWCL, data, streaming, gas, sewage)
 *  GH_AUTHORITY        : ~130 items    (GRA taxes, DVLA, FDA, NHIS, lands,
 *                                       courts, religious, port charges)
 *  GH_TWI_PIDGIN       : ~600 items    (Twi, Fante, Ga, Ewe, Hausa, Dagbani,
 *                                       Dagaare, Pidgin — full conjugations)
 *  CATEGORY_MAP        : ~415 entries  (50+ business categories)
 *  Vote detector add() : ~600 signals  (17 vote functions, 30-50 signals each,
 *                                       language-specific boosts per type)
 *  ─────────────────────────────────────────────────────────────────────
 *  TOTAL               : ~5,200 patterns
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
  // extended typos & abbreviations (+200)
  sal: "sale", sls: "sales", incom: "income", incme: "income",
  recie: "receive", recei: "received", rcv: "received",
  delv: "deliver", delvrd: "delivered", dlvrd: "delivered",
  rnt: "rent", rnted: "rented", intrst: "interest",
  commsn: "commission", comission: "commission", commsion: "commission",
  disct: "discount", dscnt: "discount", discnt: "discount",
  proft: "profit", profitt: "profit",
  expnse: "expense", opex: "expenses",
  stckd: "stocked",
  restr: "restock", rstck: "restock", rstock: "restock",
  whsl: "wholesale", whlsl: "wholesale", hlsl: "wholesale",
  slri: "salary",
  wkr: "worker", wrkr: "worker", wrkrs: "workers",
  apprntc: "apprentice", aprentice: "apprentice", apprntic: "apprentice",
  brnch: "branch", brnches: "branches",
  suppl: "supply", suppls: "supplies", supplr: "supplier",
  invstmnt: "investment",
  wthdrwl: "withdrawal", wthdraw: "withdraw", wdrawl: "withdrawal",
  rfnd: "refund", refunded: "refunded",
  trnsfer: "transfer",
  depst: "deposit", dposit: "deposit",
  wthdrw: "withdraw",
  prchse: "purchase", prchsd: "purchased", purchse: "purchase",
  pymts: "payments",
  blnce: "balance", balnc: "balance",
  accnt: "account", acct: "account", accts: "accounts",
  trnsctn: "transaction", txctn: "transaction",
  mrchnts: "merchants", mrchnt: "merchant",
  slsmn: "salesman", slswmn: "saleswoman",
  mgr: "manager", mngr: "manager",
  srvce: "service", srvc: "service", srvcs: "services",
  prduct: "product", prducts: "products", prdct: "product",
  itm: "item", itms: "items",
  gds: "goods", mrchandise: "merchandise",
  clnt: "client", clnts: "clients",
  custmr: "customer", cstmr: "customer",
  vndor: "vendor", vndr: "vendor",
  dstrbtr: "distributor", distrbtr: "distributor",
  mfctr: "manufacturer", mnfctr: "manufacturer",
  rtlr: "retailer", rtlrs: "retailers",
  whlslr: "wholesaler", whlsaler: "wholesaler",
  shpmnt: "shipment", shipmnt: "shipment",
  dspatch: "dispatch", dspch: "dispatch",
  dlvry: "delivery", dlveries: "deliveries",
  ordr: "order", ordrs: "orders", ordrd: "ordered",
  invntry: "inventory", invntori: "inventory",
  cssh: "cash",
  mny: "money", mone: "money",
  prc: "price", prce: "price",
  qty: "quantity", qnty: "quantity", quty: "quantity",
  wght: "weight", wgt: "weight",
  msure: "measure", measre: "measure",
  pckge: "package", pckg: "package", pkge: "package",
  cartn: "carton", crtn: "carton",
  bttl: "bottle",
  sachet: "sachet", sachets: "sachets",
  pkts: "packets", pkt: "packet",
  bx: "box", bxs: "boxes",
  bgs: "bags", bg: "bag",
  crte: "crate", crts: "crates",
  duzn: "dozen", dzn: "dozen",
  hlf: "half", qrtr: "quarter",
  amnt: "amount", amout: "amount", ammount: "amount",
  totl: "total", ttl: "total",
  rcrd: "record", rcrds: "records",
  entrd: "entered", recded: "recorded",
  nmbr: "number", nmber: "number",
  dtails: "details", detls: "details",
  dscription: "description", descrptn: "description",
  nte: "note", nts: "notes",
  memo: "memo", mmo: "memo",
  cmnt: "comment", cmmnts: "comments",
  nofication: "notification", notifctn: "notification",
  alrt: "alert", alrts: "alerts",
  rport: "report", rprt: "report",
  smry: "summary", smmry: "summary",
  anlysis: "analysis", anlyss: "analysis",
  prfts: "profits",
  lss: "loss", lsses: "losses",
  rvnu: "revenue", rvn: "revenue",
  cst: "cost", csts: "costs",
  fxd: "fixed",
  vrbl: "variable", varbl: "variable",
  ovrhd: "overhead", ovrhds: "overheads",
  mrgn: "margin", mrgns: "margins",
  brkevn: "breakeven", brkeven: "breakeven",
  vt: "vat", nhil: "nhil", gra: "gra",
  ecg: "ecg", gwcl: "gwcl", nedco: "nedco",
  mtn: "mtn", tcl: "telecel", atl: "airteltigo",
  gcb: "gcb", absa: "absa", stbic: "stanbic",
  fido: "fidelity", ecobnk: "ecobank",
  ssnit: "ssnit", pnsn: "pension",
  dmsor: "dumsor", tken: "token", prtd: "prepaid",
  susu: "susu", pgy: "pigmy", nananom: "nananom",
  wknd: "weekend", mnthly: "monthly", wkly: "weekly", dly: "daily",
  ytdy: "yesterday", tdy: "today", tmrw: "tomorrow",
  mrnng: "morning", aftnoon: "afternoon", evng: "evening",
  knm: "kantamanto", mkola: "makola", ksi: "kumasi",
  acc: "accra", tma: "tema", tdi: "takoradi",
  csb: "cape coast", spng: "sunyani",
  // additional abbreviations
  adb: "adb", nib: "nib", grp: "group", org: "organization",
  assoc: "association", coop: "cooperative", corp: "corporation",
  entprs: "enterprise", mkt: "market", mktng: "marketing",
  agnt: "agent", propr: "proprietor", prtner: "partner",
  dlvr: "deliver", dsptch: "dispatch",
  pckng: "packing", ldng: "loading", offld: "offload",
  clrng: "clearing", frght: "freight", cnsgnmnt: "consignment",
  exprt: "export", imprt: "import", dmstc: "domestic",
  intntl: "international", lcl: "local", frgn: "foreign",
  wrkshp: "workshop", fctry: "factory", frrm: "farm",
  acntnt: "accountant", mngmnt: "management",
  orgnz: "organize", strge: "storage", wrhse: "warehouse",
};

// ─── 2. GHANAIAN PRODUCTS (900+ items) ────────────────────────────────────────
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
  // Traditional & herbal medicine
  "sobolo leaf","moringa","neem leaf","prekese","dawadawa","odum bark",
  "African star apple","hwentia","aloe vera gel","shea butter cream",
  "herbal mixture","herbal bitters","herbal tea","roots and herbs",
  "local herbs","ghana herb","kasapreko bitters","adonko bitters",
  "hausa koko herb","akuaba herb","traditional medicine",
  // Agriculture & farming inputs
  "fertilizer","urea","npk","compost","manure","pesticide","herbicide",
  "fungicide","insecticide spray","weedicide","seeds","maize seed",
  "rice seed","tomato seedling","pepper seedling","vegetable seed",
  "cocoa seedling","rubber seedling","cashew seedling","mango seedling",
  "pawpaw seedling","garden egg seedling","kontomire seedling",
  "watering can","hoe","cutlass","spade","rake","shovel","wheelbarrow",
  "tractor service","plough service","harvesting service",
  "spraying machine","knapsack sprayer","irrigation pipe",
  "polybag","nursery bag","planting bag","greenhouse net",
  // Agro produce & raw materials
  "cocoa","cocoa beans","dried cocoa","coffee beans","shea nuts",
  "palm kernel","palm fruit","rubber","cassava chips","dried cassava",
  "groundnut paste","groundnut oil raw","shea butter raw",
  "dawadawa balls","fermented locust","dried pepper","dried tomatoes",
  "dried okro","dried fish","smoked herring","smoked tuna","salted fish",
  "koobi","momone","wele","cow skin","pig skin","goat skin",
  // Building materials & construction
  "cement","sand","gravel","granite","laterite","block","brick",
  "roofing sheet","zinc roofing","aluminium roofing","iron rod","rebar",
  "binding wire","nails","screws","bolts","nuts","hinges","padlock",
  "door handle","door lock","window handle","burglar proof","iron gate",
  "plank","mahogany","odum wood","teak","pine","plywood sheet",
  "hardboard","chipboard","plyboard","ceiling board","gypsum board",
  "tiles","floor tiles","wall tiles","bathroom tiles","ceramic tiles",
  "granite tiles","marble","terrazzo","PVC pipe","galvanized pipe",
  "copper pipe","pvc fitting","elbow fitting","tee fitting","reducer",
  "angle iron","channel iron","flat iron","square iron","hollow section",
  "paint","emulsion paint","gloss paint","primer","undercoat","varnish",
  "turpentine","brush","roller","paint tray","masking tape","sandpaper",
  "putty","filler","sealant","silicone sealant","waterproofing",
  "electrical cable","single core wire","twin earth","3 phase cable",
  "conduit pipe","junction box","switch","socket","light switch",
  "distribution board","fuse","circuit breaker","MCB","earthing rod",
  "PVC tape","insulation tape","connector","terminal block",
  // Auto parts & garage
  "engine oil","gear oil","brake fluid","power steering fluid","coolant",
  "engine oil filter","air filter","fuel filter","cabin filter",
  "spark plug","glow plug","timing belt","fan belt","serpentine belt",
  "brake pad","brake disc","brake drum","clutch plate","pressure plate",
  "clutch kit","shock absorber","coil spring","ball joint","tie rod",
  "wheel bearing","hub bearing","CV joint","axle shaft",
  "radiator","thermostat","water pump","alternator","starter motor",
  "battery terminal","fuse box","relay","sensor","oxygen sensor",
  "car battery","truck battery","motorcycle battery",
  "tyre","tube","rim","alloy wheel","tyre sealant",
  "windscreen","side mirror","headlamp","tail lamp","indicator",
  "wiper blade","wiper arm","car seat cover","floor mat",
  // Electronics & appliances
  "television","smart tv","led tv","lcd tv","plasma tv",
  "refrigerator","fridge","deep freezer","chest freezer","showcase fridge",
  "washing machine","microwave","blender","juicer","toaster",
  "electric cooker","gas cooker","gas cylinder","LPG cylinder",
  "air conditioner","split unit","window unit","standing fan","ceiling fan",
  "laptop","notebook computer","desktop","monitor","keyboard","mouse",
  "printer","scanner","photocopier","projector","CCTV camera",
  "phone case","screen protector","USB cable","OTG cable","HDMI cable",
  "WiFi router","network switch","ethernet cable","modem",
  "generator","inverter","solar panel","solar battery","charge controller",
  "UPS","voltage stabilizer","extension board","multiplug",
  // Textiles & fashion
  "ntoma","batakari","fugu","smock","kaba","kaba and slit","slit","cloth",
  "guinea brocade","java print","African print","hollandaise",
  "george wrapper","lace fabric","sequin fabric","chiffon fabric",
  "organza","taffeta","crepe","velvet fabric","denim fabric",
  "poplin","cambric","shirting fabric","suiting fabric","wool fabric",
  "ready-made dress","sewing","tailoring","alteration","embroidery",
  "shoe","heels","flat shoe","sneakers","canvas","boots","sandals",
  "handbag","clutch bag","backpack","school bag","laptop bag",
  "wallet","men wallet","ladies purse","phone pouch","waist bag",
  "hat","cap","head tie","wig cap","headwrap",
  "ankara skirt","ankara blouse","ankara dress","ankara suit","kente cloth",
  "bead necklace","bead bracelet","waist beads","earrings","ring",
  "watch","sunglasses","belt","suspenders","tie","cufflinks",
  // Office & school supplies
  "ream of paper","foolscap paper","A4 paper","A3 paper","cardboard",
  "file folder","document wallet","lever arch file","ring binder",
  "envelope","padded envelope","courier bag","stamps",
  "whiteboard","whiteboard marker","chalk","duster","notice board",
  "projector screen","flip chart","flip chart pad",
  "calculator","scientific calculator","printer ink","toner cartridge",
  "desk organizer","in-tray","staple remover","hole punch","binding machine",
  "laminating pouch","laminator","shredder","paper trimmer",
  // Food service & catering
  "disposable plate","polystyrene box","takeaway box","foil tray",
  "nylon bag","freezer bag","zip lock bag","cling film","aluminum foil",
  "toothpick","serviette","tissue","kitchen towel","gloves",
  "apron","chef uniform","hair net","serving tray","chafing dish",
  "gas burner","kerosene stove","charcoal pot","firewood",
  "charcoal","briquette","coal","kerosene",
  // Cleaning & janitorial
  "mop head","mop stick","broom","dustpan","bucket","mop bucket",
  "toilet brush","toilet cleaner","drain cleaner","mould remover",
  "floor wax","furniture polish","glass cleaner","multi-purpose cleaner",
  "sanitizer","hand sanitizer","disinfectant","antiseptic solution",
  "rubber gloves","cleaning cloth","microfibre cloth","sponge pad",
  // Hospitality & events
  "plastic chair","banquet chair","table","trestle table","tablecloth",
  "tent","canopy","marquee","generator hire","sound system",
  "PA system","speaker","microphone","mixer","amplifier",
  "backdrop","banner stand","roll-up banner","bunting","balloon",
  "decoration","flower vase","centerpiece","cake","wedding cake",
  "birthday cake","cupcake","pastry","meat pie","spring roll","samosa",
  // Pharmacy & health
  "paracetamol","ibuprofen","amoxicillin","cotrimoxazole","chloroquine","artemether",
  "coartem","ciprofloxacin","metronidazole","doxycycline","omeprazole","flagyl",
  "multivitamin","vitamin c","zinc tablet","oral rehydration salt","ors",
  "wound dressing","bandage","plaster","syringe","gloves medical","face mask",
  "sanitizer hand","thermometer","blood pressure monitor","glucometer","test strip",
  "malaria test kit","rapid test","pregnancy test","hiv test kit",
  // Pet & animal supplies
  "dog food","cat food","fish feed","poultry feed","pig feed","cattle feed",
  "animal vaccine","deworm tablet","vet drug","vet medicine","animal dip",
  "dog chain","bird cage","rabbit cage","poultry coop","fish pond net",
  // Hardware & tools
  "hammer","screwdriver","pliers","wrench","spanner","tape measure",
  "spirit level","drill","drill bit","saw","hacksaw blade","chisel",
  "nails","screws","bolts","nuts","washers","wall plug","rawl plug",
  "ladder","step ladder","extension cord","power strip","socket",
  "switch","light bulb","led bulb","fluorescent tube","ceiling fan","standing fan",
  "water pump","submersible pump","gate valve","ball valve","float valve",
  // Packaging & packaging supplies
  "polythene","polythen bag","pure water sachet","plastic bottle","glass bottle",
  "jerry can","drum","barrel","sack","jute bag","hessian bag",
  "crate","wooden crate","foam box","styrofoam","bubble wrap",
  "tape","masking tape","brown tape","sellotape","packing tape","rope",
  "twine","rubber band","seal","cap seal","bottle cap","label",
  "sticker","barcode label","price tag","hang tag","swing tag",
  // Spare parts & auto accessories
  "spark plug","fan belt","timing belt","air filter","fuel filter",
  "water pump car","head gasket","piston ring","valve","cam shaft",
  "differential oil","gear oil","power steering fluid","coolant","antifreeze",
  "wiper blade","mirror","side mirror","car seat","car mat","car cover",
  "number plate","sticker car","car alarm","car stereo","car charger",
  // Agro processing equipment
  "grinder","milling machine","palm oil press","gari processing","cassava grater",
  "corn mill","rice huller","thresher","dryer","food dryer","solar dryer",
  "storage silo","grain store","cold storage","packing machine","sealing machine",
  // Raw materials for production
  "flour","plain flour","self raising flour","cornflour","baking powder","yeast",
  "salt industrial","sugar industrial","vegetable shortening","margarine block",
  "cocoa powder","chocolate","food coloring","food flavour","vanilla","cinnamon",
  "preservative","emulsifier","citric acid","sodium benzoate","potassium sorbate",
];

// ─── 3. GHANAIAN NAMES (900+ names — built as RegExp to avoid single-line limit) ─
const GH_NAMES_LIST: string[] = [
  // Akan / Ashanti / Fante day-names & given names
  "ama","kojo","kwesi","akua","kofi","abena","kwame","adwoa","yaw","akosua",
  "afua","afia","efua","araba","mansa","maame","serwaa","asantewaa","pomaa","pokua",
  "fosuaa","boakyewaa","amoakowaa","awurama","kweku","kwabena","kobina","kwadwo","kwasi","paa",
  "nana","papa","abenaa","abeena","akuaba","akumaa","adjoa","adjoah","adwubi","afariwaa",
  "afrakoma","akofa","fafa","pomaa","akosua","efuah",
  // Akan surnames
  "mensah","boateng","asante","adjei","osei","amoah","owusu","frimpong","darko","antwi",
  "tetteh","quaye","nartey","laryea","ankrah","odartey","nkrumah","appiah","acheampong","asomaning",
  "fordjour","opoku","bonsu","oduro","sarpong","twum","kyei","ntim","manu","addai",
  "agyei","gyamfi","amponsah","takyi","asamoah","bediako","ntiamoah","bekoe","abban","aidoo",
  "ofori","baffour","donkor","boadu","okyere","asare","wiredu","kumi","obeng","aning",
  "minta","barimah","baah","fofie","yeboah","agyemang","baidoo","nkansah","adomako","adusei",
  "boampong","afram","biney","prempeh","asumadu","dadson","koomson","arhin","amissah","mensa",
  "ampah","ankumah","quartey","armah","amarteifio","acquah","blankson","quaynor","nortey","odai",
  "okai","tettey","tagoe","lamptey","dankwa","amedahe","amewu","nyarko","tsikata","fiagbenu",
  "agbemava","amegashie","sedegah","agbeko","atsu","dzodzomenyo","tsatsu","amenyo","ameya","deku",
  "fiatsi","gbadago","gblenu","koku","kudzo","kwami","norvor","tsigbey","xorse","yao",
  "yawa","adjeiboateng","adjetey","ankuma","numo","atswei","akley","akweley","akuorkor","torkornoo",
  "lomotey","kwei","ankah","martey","otoo","larbi","tackie","ashorkor",
  // Ewe / Volta Region names
  "aseye","elikplim","selali","yayra","dela","kafui","elorm","elom","mawutor","dodzi",
  "worfa","efo","dzifa","seli","enyonam","setor","ablam","abla","ablorh","senam",
  "enam","kekeli","mawuli","sena","seve","atsu","norvor","tsigbey","yao","yawa",
  "xorse","dzadzra","tsidi","tsikpe","tsitor","tsitornu","tsui","tsukudu","aveh","avornyo",
  "awaga","awah","awere","awinador","awinkuro","awisi","awotwe","awuku","awumee","awusi",
  "awusu","ayariga","ayeh","ayensu","ayim","ayimpah","ayine","ayisi","azu","azuma",
  "azumah","ameya","amenyo","agbeko","agbemava","sedegah","dzifa","dodzi","kafui","dela",
  "vovor","vovoli","gbedema","gbeku","gbene","gbewonyo","gbewura","gbedemah","gblah","gborbu",
  "gbormittah","gborse","hlovor","hormenu","hornor","hounyonou","hukpati","nutor","nuworsu",
  "etornam","etse","etsui","etuah","esinam","enam","elorm","elom","elikem",
  "fiawoo","foli","folitse","foriwaa","atobrah","atorgah","atsyam","atu","atubiga",
  "deku","fiatsi","gbadago","gblenu","koku","kudzo","kwawu","norvor",
  // Ga / Dangme names
  "nii","naa","tetteh","quaye","nartey","laryea","ankrah","odartey","lamptey","dankwa",
  "amedahe","amewu","adjeiboateng","adjetey","ankuma","numo","atswei","akley","akweley",
  "akuorkor","torkornoo","lomotey","kwei","ankah","martey","otoo","larbi","tackie","ashorkor",
  "dodoo","dogbe","dogbey","donkor","donkoh","dordah","dotse","dotson","dottey","dua",
  "duah","duho","duku","edudzi","edziyie","eghan","eguah","eyiah","eyison","eyo",
  "garbah","gapah","ghanney","ghartey","ghunney","gobah","goka","goshie","hackman","hanson",
  "hayfron","hayford","hinneh","hooper","insaidoo","insah","keelson","kobia","kotei","kotey",
  "koti","kotoh","kpakpo","kpodo","kpotoe","kramoah","krampa","krobea","krong","krubi",
  "laing","lampoh","laryeah","martey","odai","okai","okine","okoe","okoh","okpattah",
  "okyere","okyerekrom","olympio","omane","otabil","otchere","otcherebea","owiredu","owuah",
  "vanderpuye","vanderpye","vangerp","vankyei","vankyia","welbeck","wereko","wiafe",
  // Northern Ghana / Hausa / Dagomba names
  "alhassan","ali","amadu","braimah","ibrahim","issifu","mohammed","mumuni","sulemana","yakubu",
  "fusheini","bawumia","abdulai","abubakari","adam","ahmed","awal","bukari","dauda","fuseini",
  "haruna","huseini","iddrisu","issah","karim","latif","malik","moro","musah","nasiru",
  "rafiq","rashid","salifu","shaibu","tahiru","umar","wahab","yusif","zakaria","zuleiha",
  "ramatu","fati","mariama","hawa","asana","fatima","samira","zakari","ziem","zinga",
  "zinkpe","zinabu","ziribilla","ziwu","zogli","zuori","zurek","zuure","zuuroh",
  "naah","naba","nabo","nabieh","nabu","nacanabo","naale","narh","narteh","nasia",
  "ndede","neequaye","nimo","nimpong","nipah","niwan","nketia","nketsiah","nkomo",
  "nkum","nkumbun","noamesi","norgbey","nortor","novisi","nungua","nyan","nyamaah",
  "nyame","nyaneba","nyanful","nyankumah","nyatefe","nyendu","nyima","nyonu",
  "kaba","kablah","kabu","kabutey","kadama","kadjo","kadzo","kalitsi","kamaara","kamara",
  "kambu","kamil","kankam","kanor","karikari","kassim","katanga","kesse","kessie","keteku",
  "klomega","klomegah","klutse","klutsey","kodua","kodzo","koffi","kokroko","kokui","kokulo",
  "kolawole","komla","kompo","konadu","konney","kontor","korankye","korankyi","korsah","korsor",
  "kosah","kuagbenu","kuami","kudjoe","kufuor","kumah","kundor","kuntoh","kwakye","kwakyewaa",
  "laari","laar","labi","laka","lali","lamini","lasisi","lawani","lovi",
  "mahama","mahame","mahamadu","maiga","malm","malmah","mamle","manful","mante","martinson",
  "masawudu","mensimah","miclah","mintah","mireku","miza","monney","mornah","mortey","mosweu",
  "moyorbi","hamidu","hamile",
  // Christian / Western names widely used in Ghana
  "daniel","emmanuel","grace","michael","elizabeth","joseph","mary","benjamin","rebecca","samuel",
  "christiana","abraham","patience","isaac","faith","moses","comfort","philip","blessing","peter",
  "joyce","paul","gladys","john","charity","david","priscilla","george","agnes","andrew","esther",
  "mark","alice","stephen","diana","thomas","vivian","james","mavis","charles","gifty",
  "francis","eunice","eric","portia","edward","sheila","felix","mabel","henry","celestine",
  "solomon","naomi","elijah","lydia","joshua","constance","jeremiah","dorcas","linda","cynthia",
  "sandra","rose","felicia","juliana","cecilia","victoria","margaret","louisa","josephine",
  "wilhelmina","beatrice","ernestina","susana","helena","georgina","matilda","irene","abigail",
  // Additional Akan first names
  "abantie","abrempong","abrokwah","abrefa","abrefi","adukwei","aduamoah","adutwum","agyaaku",
  "agyako","agyapong","agyeman","ahenkan","ahenkorah","ahiagble","ahiati","ahorlu","ahwireng",
  "akyeampong","akyena","akyere","akrokere","akuamoah","akuffo","akuoko","akusika","akwaah",
  "akwei","akwetey","akwire","alabi","alatsinabu","allotey","allottery","alordzi","amable",
  "amankwa","amankwaa","amankwah","amantey","amartey","amartifio","amengah","amenuvor","amenyedzi",
  "amewugah","amoa","amoantwi","amoateng","amofa","ampem","ampimah","ampofo","amponsem","ampreh",
  "amui","amuzu","anane","anani","anamoah","anang","anankwaa","anatobi","andoh","anko",
  "ankobea","ankomah","ankomsah","annobil","annor","annorkor","annum","anocye","anokyewaa","anokye",
  "antobam","antobea","antobil","apam","apenteng","apiah","aponkye","appenteng","apraku","aprakuwa",
  "apreku","aryee","asabre","asafo","asagbor","asah","asampong","asapreko","aseda","asempa",
  "aseno","aseweh","asiamah","asiedu","asimenu","asirifi","asmah","asokwa","assah","assifuah",
  "asumah","asuming","asumpa","asuogyebi","ataa","atakora","atakpah","atampugre","atia","atiemo",
  "atikpui","ativor","atobra","audu","baah","baba","babah","badasu","baddoo","bagbin",
  "baidoe","baidoo","baidu","bainson","baka","banahene","bannerman","bansah","bansfo","bansa",
  "bantama","bawa","bawah","bedwei","bempah","bempa","bempong","bentil","berchie","berko",
  "berkoh","bervell","biritwum","blay","blebo","boahen","boahene","boamah","boaten","boatey",
  "bobibi","bobie","bobiw","bobo","bobu","boi","boku","bola","bonsam","boohene",
  "bosompem","bosomtwe","bosu","botah","botchway","boye","brobbey","broni","buabeng","buah",
  "buakye","buerning","bugri","bunteu","buobuo","busumuru","butah","buyeh","chacho","commey",
  "commie","compson","cobbah","cobbinah","cofie","daah","daako","daanyah","dabanka","dafia",
  "dago","dakor","danquah","dankwah","danso","danyi","dapper","darkoa","darnor","dassah",
  "datsa","dawson","debrah","dedei","dede","dedzoe","dei","denkyira","denkyiraah","denning",
  "derban","dery","devor","dikro","dinan","djan","djangmah","djokoto","dogbleku","dormaa",
  "dorwu","dumelo","duodo","duose","duprah","dusu","ebow","ebu","ebua","ebuah",
  "ebo","efia","elsi","elvina","emefa","emelia","enyam","erba","essilfie","essipong",
  "eta","fanna","fanyinbi","farkye","fianoo","fianu","fynn","gabby","gershon","gobah",
  "gona","gunu","gyasi","gyimah","gyimaa","gyamfuah","impraim","inkoom","inkoomah","inkumsah",
  "mabel","mahama","mante","mensimah","mintah","mireku","miza","monney","mornah",
  "obeng","obinim","obiri","obiribea","obirimah","obofowaa","obour","obu","ocran","ofosu",
  "ogbarmey","ohemeng","ohene","oheneba","ojukwu","okae","okrobi","okyne","opong","opuni",
  "osafo","osam","osarfo","oseiboateng","oseitwum","otunga","owuah","paapa","pabi","padi",
  "padmore","paintsil","panyin","parku","peprah","piesie","pinamang","pinkrah","pinkson","pobee",
  "poh","pompey","ponka","prah","preprah","quarshie","quarshigah","quashie","quayson","quist",
  "quistgaard","sackah","sackitey","sah","sakyibea","samlafo","sams","sarkodie","sarpomaa","savi",
  "sefah","sekyi","selormey","semefa","senanu","senu","seyram","siaw","siiba","siisi",
  "simpa","siripi","sisi","sitsofe","sitraka","sogah","somuah","sontah","sopie","sornu",
  "sorvor","sowah","sowu","soyiri","sutherland","tawiah","tawia","tay","tei","tinyase",
  "togbor","togbui","torgbor","torbi","torgah","tortoe","tuah","tuapim","tweneboah",
  "vroom","wolanyo","wornyo","worlanyo","wudah","wudu","wulff","xoese","yanney","yannor",
  "yendoh","yevunobi","yidana","yirenkyiboateng","yussif","yussuf","yuvinyoh",
];
const GH_NAMES_PATTERN = new RegExp(`\\b(${GH_NAMES_LIST.join("|")})\\b`, "i");

// ─── 4. GHANAIAN PAYMENT & INSTITUTION KEYWORDS ──────────────────────────────
const GH_MOMO_KEYWORDS: string[] = [
  "momo","mobile money","mtn","telecel","airteltigo","at money","tigo cash",
  "vodafone cash","expresspay","hubtel","slydepay","zeepay","mpay",
  "send money","mtn momo","telecel money","airteltigo money","mobile transfer",
  "mtn mobile money","m-pesa","momo transfer","momo payment",
  // extended (+32)
  "momo number","momo account","momo wallet","momo agent","momo merchant",
  "send momo","receive momo","momo received","momo sent","momo credit",
  "momo debit","momo balance","momo cashout","momo cash out","cash out momo",
  "mobile payment","mobile transfer","electronic payment","e-payment",
  "pay via momo","paid via momo","momo pay","pay momo","momo top up",
  "top up momo","load momo","momo loaded","momo float","buy float",
  "float top up","merchant payment","pay merchant","merchant collect",
  "qr payment","qr code pay","scan to pay","ussd payment","*170#","*171#",
  "at cash","tigo cash","airtel money","vodafone money","mpesa ghana",
  "wallet transfer","digital payment","fintech payment","online payment",
  "g-money","yello star","mtn yello","telecel ghana money",
];

const GH_BANK_KEYWORDS: string[] = [
  "bank","account","bank account","transfer","cal bank","gcb","ghana commercial",
  "absa","stanbic","ecobank","zenith","uba","access bank","fidelity bank",
  "prudential bank","nib","ghipss","interbank","national investment","bank of ghana",
  "agricultural development bank","adb","gh bank","bog","wire transfer",
  "bank transfer","bank payment","cheque","check","draft",
  // extended (+38)
  "republic bank","republic","first national bank","fnb","standard bank",
  "societe generale","sg ghana","omni bank","omni","first atlantic bank",
  "first atlantic","energy commercial bank","apex bank","rural bank",
  "community bank","savings and loans","microfinance bank","development bank",
  "cal bank transfer","ecobank transfer","gcb transfer","absa transfer",
  "stanbic transfer","zenith transfer","uba transfer","access transfer",
  "fidelity transfer","prudential transfer","nib transfer",
  "bank debit","bank credit","direct debit","standing order","bank draft",
  "cashier cheque","manager cheque","bankers draft","letter of credit",
  "bank guarantee","overdraft","credit facility","term loan",
  "mobile banking","internet banking","online banking","atm withdrawal",
  "atm deposit","pos terminal","pos payment","card payment","visa","mastercard",
  "debit card","credit card","chip and pin","contactless","tap to pay",
  "bank statement","swift","iban","sort code","bank code","branch code",
  "interbank transfer","cross-bank","inter-bank","ghipss instant pay",
];

const GH_UTILITIES: string[] = [
  "ecg","gwcl","nedco","vra","ghana grid","electricity company of ghana",
  "water company","ghana water","light bill","electric bill","electricity bill",
  "water bill","power bill","meter charge","meter reading","esc","units",
  "dumsor","prepaid meter","token","electricity token","water token",
  "internet bill","wifi bill","broadband","data bill","dstv","gotv","showmax",
  // extended (+45)
  "electricity company","power company","ghana electricity","national grid",
  "power outage","load shedding","power cut","blackout","brownout",
  "meter number","prepaid token","postpaid bill","electricity units",
  "water service","pipe water","bore hole","well water","tanker water",
  "garbage collection","refuse collection","waste management","sanitation fee",
  "sanitation levy","environmental fee","cleaning levy","district levy",
  "streetlight levy","community levy","development levy","infrastructure levy",
  "mtn data","telecel data","airteltigo data","data bundle","data plan",
  "night bundle","day bundle","student bundle","social media bundle",
  "whatsapp bundle","facebook bundle","unlimited bundle","weekend bundle",
  "phone bill","mobile bill","landline bill","fixed line bill",
  "internet service","ISP bill","broadband bill","fibre bill","cable internet",
  "netflix","youtube premium","spotify","apple music","amazon prime",
  "gotv lite","dstv compact","dstv premium","starsat","azam tv",
  "canal plus","openview","free-to-air","satellite tv","cable tv",
  "gas bill","lpg bill","cooking gas","natural gas","biogas",
  "sewage fee","drainage fee","septic tank","waste water","plumbing",
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
  // extended (+52)
  "gra payment","gra tax","tax clearance","tax certificate","tin number",
  "tax identification","tax filing","quarterly tax","annual tax","corporate tax",
  "personal income tax","pay as you earn","paye","withholding tax","wht",
  "stamp duty","capital gains tax","gift tax","property rate","land tax",
  "excise duty","import duty","export duty","customs duty","tariff",
  "customs valuation","customs declaration","customs bond","customs fee",
  "port charges","harbour charges","terminal handling","demurrage","storage",
  "ghana ports","tema port","takoradi port","GCNET","unipass",
  "vehicle inspection","DVLA","driver licence","licence renewal",
  "roadworthy certificate","MVIT","vehicle tax","number plate",
  "insurance certificate","insurance renewal","NIC","national insurance",
  "ghana immigration","work permit","residence permit","visa fee","passport",
  "birth certificate","marriage certificate","death certificate","NHIA","NHIS",
  "health insurance","national health","NHIS renewal","NHIS card",
  "lands commission","survey fee","title deed","land registration",
  "city planning","building inspection","planning permission","zoning fee",
  "environmental permit","EPA fee","impact assessment","business permit",
  "company registration","forms A","forms B","CAC registration","RGD",
  "national service levy","national service fee","youth employment","GYEEDA",
  "MASLOC","NBSSI","GRATIS","CSIR","GES","GHS fee","Ghana Health Service",
  "municipal fee","assembly rate","property assessment","valuation roll",
  "stall fee","market fee","market toll","market levy","market permit",
  "weighbridge fee","fumigation certificate","phytosanitary","veterinary fee",
  "police clearance","court fee","legal fee","affidavit","notary",
  "tithe monthly","first fruits offering","church dues","mosque dues",
  "mosque zakat","zakah","sadaqah","waqf contribution","church building fund",
  "convention fee","camp meeting","crusade offering","harvest offering",
];

// ─── 5. LOCAL LANGUAGE (TWI / PIDGIN / GA / EWE / HAUSA / FANTE / DAGBANI) ──
const GH_TWI_PIDGIN: string[] = [
  // ── Twi sell / buy ──────────────────────────────────────────────────────────
  "ton","tɔn","tonton","mi ton","i ton","a ton","wo ton","ɔ ton",
  "to","tɔ","mi to","i to","mi buy","i buy","wo to","ɔ to",
  "tɔn biribi","ton biribi","i ton adeɛ","me ton adeɛ",
  "mi tɔn","wo tɔn","ɔ tɔn","yɛ tɔn","wɔ tɔn","ɛ tɔn",
  // Twi want/pay — "mepɛ" = "I want/I paid for"
  "mepɛ","me pɛ","mɛpɛ","mɛ pɛ","wo pɛ","ɔ pɛ","wɔ pɛ","yɛ pɛ",
  // Twi money / pay
  "sika","pa sika","gye sika","ne sika","fa sika","bɔ","hyia",
  "kudi","ego","owo","kɔb","kɔbo","sika pa","sika gye","sika de",
  "bɔ sika","hyia sika","sika bɛ ba","sika ba","sika no ba",
  "mepa sika","wo pa sika","ɔ pa sika","mi pa sika","a pa sika",
  "sika hyia","sika hwia","me hwia sika","sika to","sika don",
  // Twi receive / give
  "gye","gya","de","kyɛ","kye","ma","fa","de bra","de ba",
  "me gye","wo gye","ɔ gye","yɛ gye","me fa","wo fa","ɔ fa",
  "me ma","wo ma","ɔ ma","yɛ ma","me de","wo de","ɔ de",
  "me kyɛ","wo kyɛ","ɔ kyɛ","yɛ kyɛ","me kye","wo kye",
  // Twi borrow / lend
  "bɔsa","bɔsa sika","de sika bɔsa","me de sika bɔsa","bɔsa me sika",
  "me bɔsa","wo bɔsa","ɔ bɔsa","yɛ bɔsa","bɔsa bi",
  // Twi debt
  "ɔka me","wo ka me","ɔ ka me","ka sika","ka me sika","ka bi",
  "wo ka","me ka","ɛ ka","wɔ ka me","n'adwuma ka",
  // Twi expense
  "tua ka","me tua","wo tua","ɔ tua","yɛ tua","tua sika",
  "tua adeɛ so","tua bi","me tua sika","adeɛ no ka",
  // Twi stock / goods
  "adeɛ","adeɛ a ɛwɔ","adeɛ gu","adeɛ firi","hyɛ adeɛ",
  "tɔ adeɛ","adeɛ tɔ","me tɔ adeɛ","me tɔ adeɛ wɔ market",
  "adeɛ baa","adeɛ no baa","adeɛ du","adeɛ no du","adeɛ no firi",
  // Twi salary
  "akoa","obi akoa","akoa ka","worker ka","akoa sika","akyɛde",
  // Twi Fante dialect
  "mi tͻn","mi tͻn biribi","mi gye sika","mi pa sika",
  "mi bͻsa","mi ka","mi tua","fante ton","fante gye",
  // ── Ga language ─────────────────────────────────────────────────────────────
  "ahe","ahe ni","mi he","wo he","ɔ he","yɛ he",      // Ga: sell
  "blɛ","mi blɛ","wo blɛ","ɔ blɛ","yɛ blɛ",           // Ga: buy
  "ji","mi ji","wo ji","ɔ ji","sika ji","sika yaafee", // Ga: receive money
  "fee","mi fee","wo fee","ɔ fee","sika fee",           // Ga: give/pay
  "ŋɔŋ","ŋɔŋ ni","sika ŋɔŋ","wo ŋɔŋ",                // Ga: owe
  "yaafee","sika yaafee","sika mi ji","sika wo ji",    // Ga: money received
  "obli","obli ni","sika obli","mi obli",              // Ga: borrow
  "kpaa","kpaa sika","sika kpaa","mi kpaa sika",       // Ga: pay back
  "ogbɔi","ogbɔi ni","mi ogbɔi",                      // Ga: debt
  "okpe","okpe ni","sika okpe","mi okpe sika",         // Ga: lend
  "shwane","shwane ni","mi shwane",                    // Ga: expense/spend
  "heyɛ","heyɛ sika","sika heyɛ",                    // Ga: get money
  // ── Ewe language ─────────────────────────────────────────────────────────────
  "dze","mi dze","wo dze","ɖe dze","dze ɖokui",       // Ewe: sell
  "xɔ","mi xɔ","wo xɔ","ɖe xɔ","xɔ ɖokui",           // Ewe: buy
  "xɔ ga","mi xɔ ga","wo xɔ ga","ɖe xɔ ga",          // Ewe: receive money
  "fa","mi fa","wo fa","ɖe fa","fa ga","mi fa ga",    // Ewe: give/pay
  "le ŋkɔ","mi le ŋkɔ","wo le ŋkɔ","ɖe le ŋkɔ",     // Ewe: in debt
  "dɔ ga","mi dɔ ga","wo dɔ ga","dɔ ɖokui",          // Ewe: borrow
  "do ga","mi do ga","wo do ga","do ɖokui",
  "le ŋku","mi le ŋku","wo le ŋku","ga le ŋku",      // Ewe: owe
  "di ga","mi di ga","wo di ga","di ɖokui",           // Ewe: pay/spend
  "de ga","mi de ga","wo de ga","de ɖokui",
  "xo ga","mi xo ga","xo ɖokui",
  "ga si","ga no","ga la","ga ŋu",                    // Ewe: money related
  // ── Hausa language ──────────────────────────────────────────────────────────
  "sayar","na sayar","ya sayar","ta sayar","mun sayar", // Hausa: sell
  "saya","na saya","ya saya","ta saya","mun saya",      // Hausa: buy
  "karba","na karba","ya karba","ta karba","karba kuɗi", // Hausa: receive
  "biya","na biya","ya biya","ta biya","mun biya",      // Hausa: pay
  "bashi","yana bashi","tana bashi","yake bashi",       // Hausa: debt/owe
  "aro","yi aro","na yi aro","bashi aro",               // Hausa: borrow
  "ranta","ya ranta","ta ranta","na ranta","mun ranta", // Hausa: lend
  "kuɗi","kuɗi ya","kuɗi ta","kuɗin","neman kuɗi",    // Hausa: money
  "fansa","na fansa","ya fansa","ta fansa","fansa bashi",// Hausa: repay
  "kasuwanci","kasuwanci ya","kasuwanci ta","kasuwanci",  // Hausa: business/trade
  "kayan","kayan daki","kayan shago","kayan gona",       // Hausa: goods
  "shago","shagon","shago ya","shago ta",                // Hausa: shop/store
  "gona","gonan","gona ya","gona ta",                    // Hausa: farm
  "aiki","aikin","aiki ya","aiki ta","albashin",         // Hausa: work/salary
  "albashi","albashin","albashi ya","albashi ta",
  "gyara","gyara ya","gyara ta","gyaran",                // Hausa: repair
  "riba","riba ya","ribanshin","riba ta",                // Hausa: profit
  "hasara","hasara ya","hasara ta","hasaran",            // Hausa: loss
  // ── Dagbani / Dagaare (Northern Ghana) ────────────────────────────────────
  "daa","mi daa","wo daa","daa kpaɣa",                  // Dagbani: buy
  "naŋ","mi naŋ","wo naŋ","naŋ kpaɣa",                 // Dagbani: sell
  "li","mi li","wo li","kpaɣa li","li kpaɣa",           // Dagbani: money/pay
  "kpaɣa","kpaɣa ni","mi kpaɣa","wo kpaɣa",            // Dagbani: money
  "ŋani","mi ŋani","wo ŋani","ŋani kpaɣa",             // Dagbani: receive
  "dali","mi dali","wo dali","dali ni","dali kpaɣa",    // Dagbani: give/pay
  "bon","mi bon","wo bon","bon kpaɣa","bɔŋ",           // Dagbani: borrow
  "tuma","mi tuma","wo tuma","tuma ni","tumsim",        // Dagbani: work
  "salo","salo ni","salo kpaɣa",                        // Dagbani: trade/market
  // ── Pidgin sell / buy ───────────────────────────────────────────────────────
  "e don sell","dem sell","make i sell","dem buy","i go buy",
  "i don sell","we don sell","dem don sell","sell finish",
  "e go sell","dem go sell","i wan sell","make dem buy",
  "i sell am","dem sell am","e sell am","we sell am",
  "dem go buy","i go buy am","make i buy","we go buy",
  // Pidgin pay / owe
  "e don pay","dem pay","e pay me","dem no pay","e no pay",
  "e owe","dem owe","owe me","e balance","balance dey",
  "dem owe me","e owe me sika","e no pay me","dem no pay me",
  "dem go pay","i go pay am","e go pay","we go pay",
  "e don pay back","dem don pay back","e pay back","pay back finish",
  "e still owe","dem still owe","e still balance","balance still dey",
  // Pidgin give / lend
  "i give am","dem give","give am credit","na credit","on credit",
  "i lend am","give loan","e take loan","borrow from me",
  "i give am money","dem give me money","e give me money",
  "lend am money","borrow am money","e borrow my money",
  "i dash am money","dem dash me","e dash me","na dash",
  // Pidgin clear / settle
  "e don clear","dem don clear","e settle","clear the debt",
  "finish pay","don pay","pay balance","e don settle",
  "dem don settle","balance clear","dem clear","e come clear",
  "settle everything","pay everything","clear everything",
  "e come pay balance","dem come settle","e come clear balance",
  // Pidgin buy stock / restock
  "i go buy goods","dem bring goods","goods arrive","goods don come",
  "i buy for shop","stock don finish","low stock","restock shop",
  "e don finish","dem don finish","goods finish","stock finish",
  "need to restock","need buy more","buy more goods","get more stock",
  "go market buy","market run","go buy goods","bring more goods",
  "new goods arrive","fresh goods","goods don load","load goods",
  // Salary / staff pidgin
  "pay worker","worker money","staff money","pay apprentice",
  "give worker pay","apprentice money","give am salary","pay am",
  "worker dey wait","staff need money","pay my people","pay my team",
  "month end pay","week end pay","end of week pay","clear salary",
  // Ghanaian phrases
  "give me on credit","take on credit","dash","i dash am","take am go",
  "bring money","send money","come pay","make e come pay",
  "carry am go","carry go","take go","e take go","dem take go",
  "collect for me","come collect","go collect","send collect",
  "balance me","balance am","give me balance","give am balance",
  "e short me","dem short me","short me sika","short me balance",
  "e cheat me","dem cheat me","e fraud me","e scam me",
  "no be business","na my shop","na my goods","na my money",
  "e no balance","e no correct","e chop my money","e take my sika",
  "make we do business","let do business","business time","market time",
  "shop open","shop dey open","open shop","close shop","shop close",
  "morning sales","evening sales","daily sales","weekly total",
  "how much e reach","how much we sell","how we do today","e go well",
  // ── More Twi expressions ─────────────────────────────────────────────────────
  "adeɛ tɔn","adeɛ tɔ","meton adeɛ","wɔton adeɛ","yɛton adeɛ",
  "mɛtɔ","yɛtɔ","wɔtɔ","ɛtɔ","mɛfa","yɛfa","wɔfa","ɛfa",
  "mɛma","yɛma","wɔma","ɛma","mɛgye","yɛgye","wɔgye","ɛgye",
  "mɛkyɛ","yɛkyɛ","wɔkyɛ","ɛkyɛ","mekyɛ adeɛ","wokyɛ adeɛ",
  "me tua bi","wo tua bi","ɔ tua bi","yɛ tua bi",
  "me ka bi","wo ka bi","ne ka bi","yɛ ka bi",
  "mɛbɔsa","yɛbɔsa","wɔbɔsa","abɔsa","bɔsa sika bi",
  "sika no tɔ","sika no gye","sika no pa","sika firi","sika kɔ",
  "adeɛ no tɔ","adeɛ no gye","me tɔn adeɛ wɔ","me tɔ adeɛ wɔ",
  "twaa","twara","twere","kyɛa","kyɛe","kyɛɛ",
  "brɛ me","brɛ me sika","fa brɛ me","brɛ sika","fa sika brɛ",
  // ── More Ga expressions ──────────────────────────────────────────────────────
  "he","he ni","he sika","mi he sika","wo he sika",
  "blɛ ni","blɛ sika","mi blɛ sika","sika blɛ",
  "ji sika","mi ji sika","wo ji sika","ɔ ji sika",
  "fee sika","mi fee sika","wo fee sika","ɔ fee sika",
  "ŋɔŋ sika","mi ŋɔŋ sika","wo ŋɔŋ sika","sika ŋɔŋ ni",
  "obli sika","mi obli sika","wo obli sika",
  "kpaa mi","kpaa wo","sika kpaa mi","mi kpaa sika no",
  "ogbɔi ni sika","mi ogbɔi sika","ogbɔi ni",
  "okpe sika","mi okpe sika","wo okpe sika",
  "shwane sika","mi shwane sika","wo shwane ni",
  "heyɛ mi sika","mi heyɛ sika","sika heyɛ mi",
  // ── More Ewe expressions ─────────────────────────────────────────────────────
  "dze ame","dze ame ga","ga dze","mi dze ga","xɔ ga ɖe","ga xɔ",
  "fa ga ɖe","fa ga kple","fa ame ga","di ga ɖo","de ga ɖe",
  "le ŋkɔ ɖe","le ŋku ɖe","dɔ ga kple","di ga nu","do ga na",
  "ga le ŋkɔ","ga le ŋku","ga dɔ","mi dɔ ga","wo dɔ ga na",
  "mi xɔ ga ɖe","wo xɔ ga ɖe","ɖe xɔ ga","mi xo ga",
  "sika ɖe","sika le","sika kple","sika na","sika dɔ","sika di",
  // ── More Hausa expressions ───────────────────────────────────────────────────
  "na sayi","ya sayi","ta sayi","mun sayi","sun sayi",
  "na saye","ya saye","ta saye","sun saye","mun saye",
  "na karbi","ya karbi","ta karbi","mun karbi","sun karbi",
  "na biya","ya biya","ta biya","mun biya kuɗi",
  "yana da bashi","tana da bashi","muna da bashi",
  "na yi aro","ya yi aro","ta yi aro","mun yi aro",
  "na ranta","ya ranta","ta ranta","mun ranta wa",
  "na fansa","ya fansa","ta fansa","mun fansa bashi",
  "kuɗi ya zo","kuɗi ta zo","an biya ni","an biya mana",
  "kayan shago","kayan kasuwanci","kayan aikin","kayan gona",
  "albashi ya zo","an biya albashi","an biya ma",
  "an yi asara","an samu riba","kasuwancin ya yi","cinikin ya yi",
  // ── More Dagbani/Dagaare expressions ────────────────────────────────────────
  "daa kpaɣa bi","naŋ kpaɣa bi","kpaɣa naŋ","kpaɣa daa",
  "mi li kpaɣa","wo li kpaɣa","mi ŋani kpaɣa","wo ŋani kpaɣa",
  "mi dali kpaɣa","wo dali kpaɣa","dali kpaɣa na","li kpaɣa ni",
  "bon kpaɣa","mi bon kpaɣa","wo bon kpaɣa","bɔŋ kpaɣa",
  "tuma ni kpaɣa","tumsim kpaɣa","salo kpaɣa bi","salo ni",
  "kpaɣa firi","kpaɣa ba","kpaɣa kɔ","kpaɣa bɛ ba",
  // ── More Pidgin variations ───────────────────────────────────────────────────
  "e go come","dem go come","dem don come","e don come",
  "dem collect am","e collect am","i go collect","make i collect",
  "dem settle am","e settle am","dem go settle","e go settle",
  "dem clear am","e clear am","i go clear","we go clear",
  "how e be today","how much e be","e be how much","how things",
  "business dey move","things dey go","sales dey move","market dey",
  "nothing today","nothing sell","nothing buy","no sales today",
  "slow today","slow market","market slow","business slow",
  "customer no come","nobody buy","nobody sell","no customer",
  "good day","good sales","sell well","buy well","e do well",
  "record am","put am down","write am down","book am","note am",
  "total am","count am","check am","balance am","check balance",
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
  // extended sale signals
  if (/\b(ahe|mi he|naŋ|i naŋ|dze|mi dze)\b/.test(norm)) add(t, 9, "ga/dagbani/ewe:sell");
  if (/\b(na sayar|ya sayar|ta sayar|mun sayar)\b/.test(norm)) add(t, 9, "hausa:sell");
  if (/\b(e ton|tonton|mi ton|wo ton|ɔ ton)\b/.test(norm)) add(t, 9, "twi:sell boost");
  if (/\b(haircut|shave|trim|braid|plait|weave|perm|relax|treatment)\b/.test(norm)) add(t, 7, "salon service");
  if (/\b(plate|bowl|cup|pack|portion|serving)\b/.test(norm) && /\b(sold|sell|food|rice|fufu|banku|kenkey|waakye)\b/.test(norm)) add(t, 7, "food sold");
  if (/\b(momo agent|float|sent|receive|charge|commission)\b/.test(norm) && !/\b(bought|buy|expense|paid)\b/.test(norm)) add(t, 5, "momo agent income");
  if (/\b(print|scan|laminate|photocopy|passport photo)\b/.test(norm) && !/\b(paid|bought|expense)\b/.test(norm)) add(t, 6, "print/scan service");
  if (/\b(repair|fix|service|maintenance)\b/.test(norm) && GH_NAMES_PATTERN.test(raw)) add(t, 5, "repair service + name");
  if (/\b(delivery fee|shipping fee|handling fee|service charge)\b/.test(norm) && !/\b(paid|expense)\b/.test(norm)) add(t, 5, "fee collected");
  if (/\b(butcher|butchering|slaughter|meat sold|fish sold)\b/.test(norm)) add(t, 7, "butcher/fish sale");
  if (/\b(farm produce|harvest|fresh produce|crops sold|yam sold|cassava sold)\b/.test(norm)) add(t, 7, "farm sale");
  if (/\b(sewed|tailored|sewn|designed|made dress|made cloth|made outfit)\b/.test(norm)) add(t, 7, "tailoring sale");
  if (/\b(installed|fixed|wired|plumbed|painted|plastered|tiled)\b/.test(norm) && !/\b(paid|expense|bill)\b/.test(norm)) add(t, 6, "artisan work done");
  if (/\b(photo|picture|shoot|photography|event photos|edited photos)\b/.test(norm) && !/\b(paid|bought)\b/.test(norm)) add(t, 6, "photography sale");
  if (/\b(tutor|teaching|lessons|coaching|class fee)\b/.test(norm) && !/\b(paid|school fees)\b/.test(norm)) add(t, 6, "tutoring income");
  if (/\b(rent received|house rent|room rent|rent payment received)\b/.test(norm)) add(t, 8, "rent received");
  if (/\b(commission received|agent commission|sales commission received)\b/.test(norm)) add(t, 7, "commission received");
  if (/\b(interest received|dividend|profit share)\b/.test(norm) && !/\b(paid|expense)\b/.test(norm)) add(t, 6, "interest/dividend received");
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
  // extended expense signals
  if (/\b(na biya|ya biya|ta biya|mun biya)\b/.test(norm)) add(t, 8, "hausa:pay");
  if (/\b(shwane|di ga|de ga|mi di ga)\b/.test(norm)) add(t, 7, "ewe:pay/spend");
  if (/\b(dali|mi dali|mi kpaɣa)\b/.test(norm)) add(t, 7, "dagbani:pay");
  if (/\b(school fees|school fee|class fee|exam fee|examination fee)\b/.test(norm)) add(t, 9, "education expense");
  if (/\b(tuition|tutorial|private school|international school)\b/.test(norm)) add(t, 7, "tuition fee");
  if (/\b(church|mosque|sunday|tithe|offering|harvest)\b/.test(norm) && /\b(paid|pay|give|gave)\b/.test(norm)) add(t, 6, "religious contribution");
  if (/\b(wedding|engagement|funeral|naming|outdooring|celebration)\b/.test(norm) && /\b(paid|spend|spent|buy|bought)\b/.test(norm)) add(t, 7, "ceremony expense");
  if (/\b(building|construction|renovation|extension|roofing|plastering|tiling)\b/.test(norm) && /\b(paid|pay|cost|expense)\b/.test(norm)) add(t, 7, "construction expense");
  if (/\b(mechanic|electrician|plumber|painter|mason|tiler|welder|carpenter)\b/.test(norm) && /\b(paid|pay|cost)\b/.test(norm)) add(t, 7, "artisan payment");
  if (/\b(internet data|data top up|wifi payment|broadband payment)\b/.test(norm)) add(t, 7, "internet expense");
  if (/\b(hotel|accommodation|lodge|guesthouse|rest house)\b/.test(norm) && /\b(paid|pay|cost)\b/.test(norm)) add(t, 7, "accommodation expense");
  if (/\b(insurance premium|insurance payment|insurance renewal|car insurance|fire insurance)\b/.test(norm)) add(t, 8, "insurance payment");
  if (/\b(legal|lawyer|solicitor|attorney|court|affidavit|notary)\b/.test(norm) && /\b(paid|fee|cost)\b/.test(norm)) add(t, 7, "legal expense");
  if (/\b(accounting|bookkeeping|audit|accountant fee)\b/.test(norm)) add(t, 6, "accounting fee");
  if (/\b(courier|DHL|fedex|post office|postal|delivery charge)\b/.test(norm) && /\b(paid|pay)\b/.test(norm)) add(t, 6, "courier expense");
  if (/\b(parking fee|parking charge|car park)\b/.test(norm)) add(t, 5, "parking");
  if (/\b(cold room|cold store|freezer hire|storage fee|warehouse rent)\b/.test(norm)) add(t, 7, "storage cost");
  if (/\b(cocoa farmer|farmer expense|farm expense|agric expense|crop expense)\b/.test(norm)) add(t, 6, "farm expense");
}

// ── DEBT (27 signals) ─────────────────────────────────────────────────────────
function runDebtVotes(norm: string, raw: string, add: VoteMap["add"]) {
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
  // extended debt signals
  if (/\b(ɔka me|wo ka me|ɛ ka|ka me sika)\b/.test(norm)) add(t, 9, "twi:owe");
  if (/\b(le ŋkɔ|le ŋku|mi le ŋkɔ)\b/.test(norm)) add(t, 8, "ewe:owe");
  if (/\b(ŋɔŋ|sika ŋɔŋ|mi ŋɔŋ)\b/.test(norm)) add(t, 8, "ga:owe");
  if (/\b(yana bashi|yake bashi|bashi)\b/.test(norm)) add(t, 8, "hausa:owe");
  if (/\b(ka|mi ka|wo ka)\b/.test(norm) && GH_NAMES_PATTERN.test(raw)) add(t, 7, "twi:debt+name");
  if (/\b(book am|write am|record am)\b/.test(norm) && /\b(credit|owe|debt)\b/.test(norm)) add(t, 7, "record credit");
  if (/\b(e carry go|dem carry go)\b/.test(norm) && !/\bpaid\b/.test(norm)) add(t, 7, "pidgin:took goods");
  if (/\b(account book|credit book|debt book|owe list)\b/.test(norm)) add(t, 6, "credit book");
  if (/\b(school fee debt|utility debt|rent debt|outstanding bill)\b/.test(norm)) add(t, 7, "outstanding bill");
  if (/\b(farmer credit|agric credit|input credit)\b/.test(norm)) add(t, 6, "agric credit");
  if (/\b(buy now pay later|pay when you can|deferred payment)\b/.test(norm)) add(t, 8, "deferred payment");
  if (/\b(e dash me|dem dash me)\b/.test(norm) && /\b(goods|item|product)\b/.test(norm)) add(t, 5, "dashed goods no pay");
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
  // extended repayment signals
  if (/\b(pa sika|gye sika|pa me sika)\b/.test(norm)) add(t, 9, "twi:pay me money");
  if (/\b(na karba|ya karba|ta karba|karba kuɗi)\b/.test(norm)) add(t, 8, "hausa:received");
  if (/\b(xɔ ga|mi xɔ ga|xo ga)\b/.test(norm)) add(t, 8, "ewe:received money");
  if (/\b(ji|mi ji|sika ji)\b/.test(norm) && GH_NAMES_PATTERN.test(raw)) add(t, 7, "ga:received+name");
  if (/\b(naŋ|mi naŋ)\b/.test(norm) && /\b(paid|pay)\b/.test(norm)) add(t, 7, "dagbani:received");
  if (/\b(e come|dem come|they come|came today)\b/.test(norm) && /\b(pay|paid|money|sika)\b/.test(norm)) add(t, 8, "came to pay today");
  if (/\b(send me momo|sent me momo|momo from|got momo)\b/.test(norm)) add(t, 8, "momo repayment");
  if (/\b(bank transfer received|bank payment received|bank credited)\b/.test(norm)) add(t, 8, "bank repayment");
  if (/\b(school fees paid|rent paid|utility paid|ecg paid|water paid)\b/.test(norm) && GH_NAMES_PATTERN.test(raw)) add(t, 6, "bill paid by someone");
  if (/\b(farmer paid|agric customer paid|input loan paid)\b/.test(norm)) add(t, 7, "farm credit paid");
  if (/\b(e remember|dem remember|finally came|eventually came)\b/.test(norm) && /\b(pay|paid|money)\b/.test(norm)) add(t, 6, "finally paid");
  if (/\b(susu day|susu collect|my susu turn|susu win|won susu)\b/.test(norm)) add(t, 8, "susu collection");
  if (/\b(NHIS|insurance claim paid|claim received|payout received)\b/.test(norm)) add(t, 7, "insurance payout");
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
  // extended stock purchase signals
  if (/\b(mi to|i to|me tɔ adeɛ|me tɔ biribi)\b/.test(norm)) add(t, 8, "twi:buy goods");
  if (/\b(blɛ|mi blɛ)\b/.test(norm) && GH_PRODUCTS.some((p) => norm.includes(p))) add(t, 7, "ga:buy product");
  if (/\b(na saya|ya saya|ta saya|mun saya)\b/.test(norm) && GH_PRODUCTS.some((p) => norm.includes(p))) add(t, 7, "hausa:buy product");
  if (/\b(daa|mi daa)\b/.test(norm) && GH_PRODUCTS.some((p) => norm.includes(p))) add(t, 7, "dagbani:buy product");
  if (/\b(xɔ|mi xɔ|xo|dze|mi dze)\b/.test(norm) && GH_PRODUCTS.some((p) => norm.includes(p))) add(t, 7, "ewe:buy product");
  if (/\b(makola|kantamanto|kumasi market|asafo market|techiman|kejetia)\b/.test(norm) && /\b(buy|bought|go|went|purchase)\b/.test(norm)) add(t, 9, "major market purchase");
  if (/\b(imported|imported goods|foreign goods|china goods|dubai goods|secondhand)\b/.test(norm) && /\b(bought|buy|purchase)\b/.test(norm)) add(t, 7, "imported goods");
  if (/\b(cocoa input|farm input|agric input|farming materials)\b/.test(norm) && /\b(bought|buy|purchase|paid)\b/.test(norm)) add(t, 8, "farm input purchase");
  if (/\b(loading goods|offloading|received delivery|goods delivered|supplier delivered)\b/.test(norm)) add(t, 8, "goods delivery");
  if (/\b(container|40 foot|20 foot|shipment arrived|consignment)\b/.test(norm) && /\b(goods|stock|items|merchandise)\b/.test(norm)) add(t, 9, "container/shipment");
  if (/\b(depot|wholesale depot|distribution center|warehouse)\b/.test(norm) && /\b(bought|buy|purchase|collected|got)\b/.test(norm)) add(t, 8, "depot purchase");
  if (/\b(market woman|market man|trader|hawker)\b/.test(norm) && /\b(bought|buy|from)\b/.test(norm)) add(t, 6, "bought from trader");
  if (/\b(cold room stock|frozen goods|frozen stock|frozen food)\b/.test(norm) && /\b(bought|buy|purchase)\b/.test(norm)) add(t, 7, "frozen stock purchase");
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
  // language-specific cost signals
  if (/\b(shwane|mi shwane|wo shwane)\b/.test(norm)) add(t, 8, "ga:spend");
  if (/\b(tua ka|me tua|adeɛ no ka)\b/.test(norm)) add(t, 8, "twi:expense");
  if (/\b(di ga|de ga|mi di ga)\b/.test(norm)) add(t, 8, "ewe:pay/spend");
  if (/\b(na biya|ya biya|an biya)\b/.test(norm)) add(t, 8, "hausa:paid");
  if (/\b(mi dali|wo dali|dali kpaɣa)\b/.test(norm)) add(t, 7, "dagbani:pay");
  if (/\b(i spend|i pay|we spend|dem spend)\b/.test(norm)) add(t, 6, "pidgin:spend");
  if (/\b(kwatir|quatir|four quarter|quarterly charge)\b/.test(norm)) add(t, 7, "quarterly bill");
  if (/\b(annual fee|yearly charge|per annum)\b/.test(norm)) add(t, 7, "annual charge");
  if (/\b(service charge|service fee|handling fee)\b/.test(norm)) add(t, 7, "service fee");
  if (/\b(subscription fee|membership fee|dues)\b/.test(norm)) add(t, 7, "dues/subscription");
  if (/\b(cooling|refrigeration|cold chain)\b/.test(norm) && /\b(paid|pay|rent|hire)\b/.test(norm)) add(t, 7, "cold chain cost");
  if (/\b(shared cost|split cost|portion of)\b/.test(norm)) add(t, 6, "shared cost");
  if (/\b(printing|stationery|office supplies)\b/.test(norm) && /\b(paid|buy|purchase)\b/.test(norm)) add(t, 6, "office supplies cost");
  if (/\b(advertising cost|marketing cost|promo cost)\b/.test(norm)) add(t, 7, "marketing cost");
  if (/\b(training|workshop|seminar|course)\b/.test(norm) && /\b(paid|fee|cost)\b/.test(norm)) add(t, 6, "training cost");
  if (/\b(legal|lawyer|solicitor|court)\b/.test(norm) && /\b(paid|fee|cost)\b/.test(norm)) add(t, 7, "legal cost");
  if (/\b(bank charge|bank fee|account charge|ledger fee)\b/.test(norm)) add(t, 8, "bank charge");
  if (/\b(commission paid|agent fee|broker fee)\b/.test(norm)) add(t, 7, "agent fee");
  if (/\b(depreciation|amortization|write off)\b/.test(norm)) add(t, 6, "depreciation");
  if (/\b(rent advance|advance rent|key money)\b/.test(norm)) add(t, 9, "rent advance");
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
  // extended salary signals
  if (/\b(albashin|albashi)\b/.test(norm)) add(t, 9, "hausa:salary");
  if (/\b(akoa ka|akoa sika|akyɛde)\b/.test(norm)) add(t, 8, "twi:worker pay");
  if (/\b(tumsim|tuma ni)\b/.test(norm) && /\b(paid|pay|money|sika|kpaɣa)\b/.test(norm)) add(t, 7, "dagbani:work pay");
  if (/\b(welder|carpenter|mason|painter|tiler|plumber|electrician)\b/.test(norm) && /\b(paid|pay|salary|wages?)\b/.test(norm)) add(t, 8, "artisan pay");
  if (/\b(driver|truck driver|lorry driver|delivery man)\b/.test(norm) && /\b(paid|pay|salary|wages?)\b/.test(norm)) add(t, 8, "driver pay");
  if (/\b(cleaner|janitor|sweeper|gardener|gateman|watchnight)\b/.test(norm) && /\b(paid|pay|salary|wages?)\b/.test(norm)) add(t, 7, "support staff pay");
  if (/\b(farm worker|field worker|harvester|picker|planter)\b/.test(norm) && /\b(paid|pay|wages?)\b/.test(norm)) add(t, 7, "farm worker pay");
  if (/\b(hawker|table top|street seller|roadside seller)\b/.test(norm) && /\b(paid|pay|wages?|commission)\b/.test(norm)) add(t, 6, "hawker pay");
  if (/\b(nurse|midwife|health worker|community health)\b/.test(norm) && /\b(paid|pay|salary|wages?)\b/.test(norm)) add(t, 7, "health worker pay");
  if (/\b(teacher|instructor|coach|tutor)\b/.test(norm) && /\b(paid|pay|salary|wages?)\b/.test(norm)) add(t, 7, "teacher pay");
  if (/\b(mates|conductor|driver mate)\b/.test(norm) && /\b(paid|pay|wages?|daily)\b/.test(norm)) add(t, 7, "trotro mate pay");
  if (/\b(gave him|gave her|give him|give her)\b/.test(norm) && /\b(salary|wages?|his money|her money|pay)\b/.test(norm)) add(t, 8, "gave him/her pay");
  if (/\b(staff salary|employee salary|worker salary|team pay)\b/.test(norm)) add(t, 9, "staff salary phrase");
  if (/\b(end of month salary|month end pay|payday)\b/.test(norm)) add(t, 9, "payday phrase");
  if (/\b(piecework|piece work|task pay|completion pay)\b/.test(norm)) add(t, 7, "piecework pay");
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
  // ── Ga language boosts ─────────────────────────────────────────────────────
  if (/\b(ahe|mi he|he sika)\b/.test(norm)) add("sale", 8, "ga:sell");
  if (/\b(blɛ|mi blɛ|blɛ sika)\b/.test(norm)) add("stock_purchase", 8, "ga:buy");
  if (/\b(ji sika|mi ji|heyɛ sika|yaafee)\b/.test(norm)) add("repayment", 8, "ga:receive money");
  if (/\b(fee sika|mi fee|kpaa sika)\b/.test(norm)) add("expense", 7, "ga:pay/give");
  if (/\b(ŋɔŋ|ogbɔi ni|sika ŋɔŋ)\b/.test(norm)) add("debt", 8, "ga:owe");
  if (/\b(obli|mi obli|obli sika)\b/.test(norm)) add("borrow_in", 8, "ga:borrow");
  if (/\b(okpe|mi okpe|okpe sika)\b/.test(norm)) add("borrow_out", 7, "ga:lend");
  if (/\b(shwane|mi shwane)\b/.test(norm)) add("cost", 7, "ga:expense");
  // ── Ewe language boosts ────────────────────────────────────────────────────
  if (/\b(dze|mi dze|dze ga)\b/.test(norm)) add("sale", 8, "ewe:sell");
  if (/\b(xɔ|mi xɔ|xɔ ɖokui)\b/.test(norm)) add("stock_purchase", 8, "ewe:buy");
  if (/\b(xɔ ga|mi xɔ ga|ga xɔ)\b/.test(norm)) add("repayment", 8, "ewe:receive money");
  if (/\b(fa|mi fa|fa ga|di ga)\b/.test(norm) && /\b(sika|ga|money)\b/.test(norm)) add("expense", 7, "ewe:give/pay");
  if (/\b(le ŋkɔ|le ŋku|ga le ŋkɔ)\b/.test(norm)) add("debt", 8, "ewe:owe");
  if (/\b(dɔ ga|do ga|mi dɔ ga)\b/.test(norm)) add("borrow_in", 8, "ewe:borrow");
  // ── Hausa language boosts ──────────────────────────────────────────────────
  if (/\b(na sayar|ya sayar|mun sayar)\b/.test(norm)) add("sale", 9, "hausa:sell");
  if (/\b(na saya|ya saya|mun saya)\b/.test(norm)) add("stock_purchase", 9, "hausa:buy");
  if (/\b(na karba|ya karba|ta karba|an biya ni)\b/.test(norm)) add("repayment", 8, "hausa:receive/paid");
  if (/\b(na biya|ya biya|ta biya|mun biya)\b/.test(norm)) add("expense", 8, "hausa:pay");
  if (/\b(yana bashi|tana bashi|da bashi)\b/.test(norm)) add("debt", 9, "hausa:owe");
  if (/\b(na yi aro|ya yi aro|yi aro)\b/.test(norm)) add("borrow_in", 8, "hausa:borrow");
  if (/\b(na ranta|ya ranta|ranta wa)\b/.test(norm)) add("borrow_out", 8, "hausa:lend");
  if (/\b(na fansa|ya fansa|fansa bashi)\b/.test(norm)) add("loan_repay_out", 8, "hausa:repay");
  if (/\b(albashi ya|albashin|an biya albashi)\b/.test(norm)) add("salary", 9, "hausa:salary paid");
  // ── Dagbani/Dagaare language boosts ───────────────────────────────────────
  if (/\b(naŋ|mi naŋ|naŋ kpaɣa)\b/.test(norm)) add("sale", 8, "dagbani:sell");
  if (/\b(daa|mi daa|daa kpaɣa)\b/.test(norm)) add("stock_purchase", 8, "dagbani:buy");
  if (/\b(ŋani|mi ŋani|ŋani kpaɣa)\b/.test(norm)) add("repayment", 7, "dagbani:receive");
  if (/\b(dali|mi dali|dali kpaɣa)\b/.test(norm)) add("expense", 7, "dagbani:pay");
  if (/\b(bon|mi bon|bon kpaɣa)\b/.test(norm)) add("borrow_in", 7, "dagbani:borrow");
  if (/\b(tuma|mi tuma|tuma ni)\b/.test(norm)) add("salary", 7, "dagbani:work/salary");
  // ── Additional Pidgin boosts ───────────────────────────────────────────────
  if (/\b(sell finish|sell complete|all sell)\b/.test(norm)) add("sale", 8, "pidgin:all sold");
  if (/\b(e don give|dem give am|give am)\b/.test(norm) && /\b(money|cash|sika|pay)\b/.test(norm)) add("repayment", 7, "pidgin:give money");
  if (/\b(record am|book am|write am|note am)\b/.test(norm)) add("debt", 5, "pidgin:record transaction");
  if (/\b(balance dey|e owe balance|still balance)\b/.test(norm)) add("debt", 7, "pidgin:balance owed");
  if (/\b(restock shop|get more goods|go market buy)\b/.test(norm)) add("stock_purchase", 8, "pidgin:restock");
  if (/\b(dem pay salary|pay my people|month end pay)\b/.test(norm)) add("salary", 8, "pidgin:pay salary");
  if (/\b(slow market|nothing sell|no sales)\b/.test(norm)) add("sale", -3, "pidgin:slow market");
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
  // extended (+145)
  banner: "Marketing", poster: "Marketing", radio: "Marketing", tv: "Marketing",
  promotion: "Marketing", social: "Marketing", facebook: "Marketing",
  "social media": "Marketing", influencer: "Marketing", sponsored: "Marketing",
  "whatsapp marketing": "Marketing", "broadcast message": "Marketing",
  petrol: "Generator & fuel", genset: "Generator & fuel", power: "Generator & fuel",
  "filling station": "Generator & fuel", "fuel station": "Generator & fuel",
  "petrol station": "Generator & fuel",
  vehicle: "Transport", car: "Transport", truck: "Transport",
  motorbike: "Transport", "bike delivery": "Transport", courier: "Transport",
  "transport fare": "Transport", "road toll": "Transport", "toll fee": "Transport",
  pharmacy: "Medical", drug: "Medical", medicine: "Medical", nurse: "Medical",
  doctor: "Medical", health: "Medical", treatment: "Medical", injection: "Medical",
  "health insurance": "Medical", "nhis": "Medical", "nhia": "Medical",
  "paracetamol": "Medical", "malaria drug": "Medical", "blood test": "Medical",
  haircut: "Salon & Barbering", "hair cut": "Salon & Barbering",
  barber: "Salon & Barbering", salon: "Salon & Barbering", braiding: "Salon & Barbering",
  weave: "Salon & Barbering", perming: "Salon & Barbering", relaxer: "Salon & Barbering",
  makeup: "Salon & Barbering", pedicure: "Salon & Barbering", manicure: "Salon & Barbering",
  waxing: "Salon & Barbering", threading: "Salon & Barbering", facial: "Salon & Barbering",
  rice: "Food & Beverages", fufu: "Food & Beverages", banku: "Food & Beverages",
  kenkey: "Food & Beverages", waakye: "Food & Beverages", jollof: "Food & Beverages",
  "fried rice": "Food & Beverages", "light soup": "Food & Beverages",
  "groundnut soup": "Food & Beverages", "palm nut soup": "Food & Beverages",
  "kontomire": "Food & Beverages", "kelewele": "Food & Beverages",
  "roasted plantain": "Food & Beverages", "roasted yam": "Food & Beverages",
  tilapia: "Food & Beverages", "grilled tilapia": "Food & Beverages",
  beef: "Food & Beverages", chicken: "Food & Beverages", pork: "Food & Beverages",
  "goat meat": "Food & Beverages", "turkey tail": "Food & Beverages",
  malt: "Food & Beverages", fanta: "Food & Beverages", coke: "Food & Beverages",
  beer: "Food & Beverages", sobolo: "Food & Beverages", "fan ice": "Food & Beverages",
  "pure water": "Food & Beverages", "sachet water": "Food & Beverages",
  "bottled water": "Food & Beverages", "energy drink": "Food & Beverages",
  airtime: "Airtime & Data", credit: "Airtime & Data", recharge: "Airtime & Data",
  data: "Airtime & Data", bundle: "Airtime & Data", "data bundle": "Airtime & Data",
  sim: "Airtime & Data", "sim card": "Airtime & Data",
  cement: "Building Materials", sand: "Building Materials", gravel: "Building Materials",
  block: "Building Materials", "iron rod": "Building Materials", rebar: "Building Materials",
  tile: "Building Materials", tiles: "Building Materials", wood: "Building Materials",
  plank: "Building Materials", paint: "Building Materials", wire: "Building Materials",
  pipe: "Building Materials", fitting: "Building Materials",
  "spare parts": "Auto Parts", "car parts": "Auto Parts", tyre: "Auto Parts",
  "engine oil": "Auto Parts", "brake pad": "Auto Parts", battery: "Auto Parts",
  "oil filter": "Auto Parts", "air filter": "Auto Parts", alternator: "Auto Parts",
  "shock absorber": "Auto Parts", bearing: "Auto Parts",
  cocoa: "Cash Crops & Agro", "shea nuts": "Cash Crops & Agro",
  "palm fruit": "Cash Crops & Agro", "palm kernel": "Cash Crops & Agro",
  rubber: "Cash Crops & Agro", cashew: "Cash Crops & Agro",
  coffee: "Cash Crops & Agro", "groundnut": "Cash Crops & Agro",
  fertilizer: "Farm Inputs", pesticide: "Farm Inputs", herbicide: "Farm Inputs",
  seeds: "Farm Inputs", seedling: "Farm Inputs", "farming inputs": "Farm Inputs",
  decoration: "Events & Hospitality", catering: "Events & Hospitality",
  tent: "Events & Hospitality", canopy: "Events & Hospitality",
  cake: "Events & Hospitality", "sound system": "Events & Hospitality",
  "event planning": "Events & Hospitality", funeral: "Events & Hospitality",
  "outdoor catering": "Events & Hospitality", DJ: "Events & Hospitality",
  fabric: "Textiles & Fashion", cloth: "Textiles & Fashion",
  "ankara": "Textiles & Fashion", kente: "Textiles & Fashion",
  "sewing": "Textiles & Fashion", tailoring: "Textiles & Fashion",
  "ready made": "Textiles & Fashion", fashion: "Textiles & Fashion",
  "second hand": "Second-Hand Goods", "bend-down boutique": "Second-Hand Goods",
  "okirika": "Second-Hand Goods", "kantamanto": "Second-Hand Goods",
  "used clothes": "Second-Hand Goods", "used goods": "Second-Hand Goods",
  school: "Education", fees: "Education", tuition: "Education",
  uniform: "Education", "school fees": "Education", "exam fees": "Education",
  textbook: "Education", "school book": "Education", "private lesson": "Education",
  printing: "Printing & Stationery", stationery: "Printing & Stationery",
  "office supplies": "Printing & Stationery", toner: "Printing & Stationery",
  photocopy: "Printing & Stationery", laminating: "Printing & Stationery",
  phone: "Electronics", charger: "Electronics", earphone: "Electronics",
  laptop: "Electronics", computer: "Electronics", tablet: "Electronics",
  television: "Electronics", fridge: "Electronics", freezer: "Electronics",
  "solar panel": "Electronics", inverter: "Electronics", UPS: "Electronics",
  susu: "Savings & Credit Groups", "nananom": "Savings & Credit Groups",
  "daily contribution": "Savings & Credit Groups", "weekly susu": "Savings & Credit Groups",
  "susu contribution": "Savings & Credit Groups", "susu pay": "Savings & Credit Groups",
  "group savings": "Savings & Credit Groups", "rotating fund": "Savings & Credit Groups",
  // Additional categories (+100)
  agric: "Agriculture", farming: "Agriculture", crop: "Agriculture", harvest: "Agriculture",
  cassava: "Agriculture", yam: "Agriculture", maize: "Agriculture", plantain: "Agriculture",
  cocoyam: "Agriculture", tomato: "Agriculture", pepper: "Agriculture", onion: "Agriculture",
  "cowpea": "Agriculture", soya: "Agriculture", "groundnuts": "Agriculture",
  moringa: "Herbal & Traditional", neem: "Herbal & Traditional", prekese: "Herbal & Traditional",
  "herbal bitters": "Herbal & Traditional", bitters: "Herbal & Traditional",
  adonko: "Herbal & Traditional", kasapreko: "Herbal & Traditional",
  "dawadawa": "Herbal & Traditional", "shea butter": "Herbal & Traditional",
  poultry: "Livestock & Poultry", broiler: "Livestock & Poultry", layer: "Livestock & Poultry",
  "day old chick": "Livestock & Poultry", "poultry feed": "Livestock & Poultry",
  cattle: "Livestock & Poultry", cow: "Livestock & Poultry", sheep: "Livestock & Poultry",
  goat: "Livestock & Poultry", pig: "Livestock & Poultry", rabbit: "Livestock & Poultry",
  catfish: "Aquaculture", "cat fish": "Aquaculture", fish: "Aquaculture",
  "fish pond": "Aquaculture", "fish feed": "Aquaculture", "fish farm": "Aquaculture",
  "smoked fish": "Aquaculture", "dried fish": "Aquaculture",
  woodwork: "Carpentry & Furniture", furniture: "Carpentry & Furniture",
  cabinet: "Carpentry & Furniture", cupboard: "Carpentry & Furniture",
  "table made": "Carpentry & Furniture", "chair made": "Carpentry & Furniture",
  welding: "Metal Fabrication", "metal work": "Metal Fabrication",
  "iron gate": "Metal Fabrication", "steel door": "Metal Fabrication",
  "iron window": "Metal Fabrication", "metal fabrication": "Metal Fabrication",
  plumbing: "Plumbing", "pipe fitting": "Plumbing", "water pipe": "Plumbing",
  "sanitary ware": "Plumbing", toilet: "Plumbing", shower: "Plumbing",
  electrical: "Electrical Work", wiring: "Electrical Work", switchboard: "Electrical Work",
  "electrical installation": "Electrical Work", "power point": "Electrical Work",
  "gen set": "Power & Generator", "power inverter": "Power & Generator",
  "solar system": "Power & Generator", "solar installation": "Power & Generator",
  "power backup": "Power & Generator", "UPS system": "Power & Generator",
  photography: "Photography & Media", videography: "Photography & Media",
  editing: "Photography & Media", "video editing": "Photography & Media",
  graphics: "Photography & Media", design: "Photography & Media",
  branding: "Photography & Media", logo: "Photography & Media",
  laundry: "Laundry & Dry Cleaning", "dry cleaning": "Laundry & Dry Cleaning",
  "laundry service": "Laundry & Dry Cleaning", ironing: "Laundry & Dry Cleaning",
  "outside catering": "Catering & Food Service",
  "food delivery": "Catering & Food Service", "chop bar": "Catering & Food Service",
  restaurant: "Catering & Food Service", "food vendor": "Catering & Food Service",
  bakery: "Bakery & Confectionery", bread: "Bakery & Confectionery",
  "pastry shop": "Bakery & Confectionery", "sweet bread": "Bakery & Confectionery",
  "meat pie baked": "Bakery & Confectionery", biscuit: "Bakery & Confectionery",
  "wholesale buying": "Wholesale & Distribution", distributor: "Wholesale & Distribution",
  "wholesale price": "Wholesale & Distribution", bulk: "Wholesale & Distribution",
  "trade price": "Wholesale & Distribution", "trade discount": "Wholesale & Distribution",
  spare: "Spare Parts & Servicing", servicing: "Spare Parts & Servicing",
  "car service": "Spare Parts & Servicing", "oil change": "Spare Parts & Servicing",
  "tyre change": "Spare Parts & Servicing", vulcanizing: "Spare Parts & Servicing",
  "car wash": "Car Wash & Auto Services", "car clean": "Car Wash & Auto Services",
  "bus wash": "Car Wash & Auto Services", "truck wash": "Car Wash & Auto Services",
  "engine wash": "Car Wash & Auto Services",
  "estate agent": "Real Estate", "property agent": "Real Estate",
  "house rent": "Real Estate", "room rent": "Real Estate", "house sale": "Real Estate",
  "land sale": "Real Estate", "property sale": "Real Estate",
  "mortgage payment": "Real Estate", "land purchase": "Real Estate",
  forex: "Currency Exchange", "currency exchange": "Currency Exchange",
  "money exchange": "Currency Exchange", "forex bureau": "Currency Exchange",
  "dollar exchange": "Currency Exchange", "pound exchange": "Currency Exchange",
  "euro exchange": "Currency Exchange", "cedis exchange": "Currency Exchange",
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
