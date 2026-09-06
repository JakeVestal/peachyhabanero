/* Official titles/notes from FRED series pages or Treasury Fiscal Data.
   Justification is ours: why the cube keeps the column. */
window.COLUMN_NOTES = {
  FEDFUNDS: {
    title: "Federal Funds Effective Rate",
    source: "Board of Governors of the Federal Reserve System (US)",
    units: "Percent, monthly average of business days, NSA",
    url: "https://fred.stlouisfed.org/series/FEDFUNDS",
    official:
      "The federal funds rate is the interest rate at which depository institutions trade federal funds (balances held at Federal Reserve Banks) with each other overnight. Series is a monthly average of daily figures (H.15).",
    why: "Policy rate in F1. Compared with the effective coupon on the debt stock: when funds has already met the book, a hike is the fiscal rate.",
  },
  TB3MS: {
    title: "3-Month Treasury Bill Secondary Market Rate, Discount Basis",
    source: "Board of Governors of the Federal Reserve System (US)",
    units: "Percent, monthly average, discount basis, NSA",
    url: "https://fred.stlouisfed.org/series/TB3MS",
    official:
      "Averages of business days, discount basis. H.15 Selected Interest Rates.",
    why: "Short risk-free bill rate sitting next to funds. Sanity check that F1 is not an artifact of the effective-funds print alone.",
  },
  DGS10: {
    title: "Market Yield on U.S. Treasury Securities at 10-Year Constant Maturity, Quoted on an Investment Basis",
    source: "Board of Governors of the Federal Reserve System (US)",
    units: "Percent, daily, NSA",
    url: "https://fred.stlouisfed.org/series/DGS10",
    official:
      "Treasury constant-maturity 10-year yield from the H.15 / Treasury yield curve methodology.",
    why: "Long rate context for term premium and r. Not a headline wire; kept so a reader can see the yield the ACM/Kim-Wright premium sits on.",
  },
  DGS2: {
    title: "Market Yield on U.S. Treasury Securities at 2-Year Constant Maturity, Quoted on an Investment Basis",
    source: "Board of Governors of the Federal Reserve System (US)",
    units: "Percent, daily, NSA",
    url: "https://fred.stlouisfed.org/series/DGS2",
    official:
      "Treasury constant-maturity 2-year yield from the H.15 / Treasury yield curve methodology.",
    why: "Front of the curve. Pair with DGS10 / T10Y2Y to see whether the term structure is already charging for duration.",
  },
  A091RC1Q027SBEA: {
    title: "Federal government current expenditures: Interest payments",
    source: "U.S. Bureau of Economic Analysis",
    units: "Billions of dollars, quarterly SAAR",
    url: "https://fred.stlouisfed.org/series/A091RC1Q027SBEA",
    official:
      "BEA NIPA account code A091RC. Federal current expenditures that are interest payments, seasonally adjusted annual rate.",
    why: "Numerator for F2 (interest / receipts) and for the effective coupon in F1 and r−g (interest ÷ debt stock).",
  },
  FGRECPT: {
    title: "Federal Government Current Receipts",
    source: "U.S. Bureau of Economic Analysis",
    units: "Billions of dollars, quarterly SAAR",
    url: "https://fred.stlouisfed.org/series/FGRECPT",
    official:
      "NIPA federal current receipts, seasonally adjusted annual rate. The till: taxes plus other current receipts.",
    why: "Denominator of F2. A 100bp coupon step is a program only relative to what actually comes in.",
  },
  W006RC1Q027SBEA: {
    title: "Federal government current tax receipts",
    source: "U.S. Bureau of Economic Analysis",
    units: "Billions of dollars, quarterly SAAR",
    url: "https://fred.stlouisfed.org/series/W006RC1Q027SBEA",
    official:
      "BEA NIPA federal current tax receipts only (excludes some non-tax current receipts in FGRECPT).",
    why: "Narrower till. Side column so F2 is not an artifact of non-tax receipts.",
  },
  FGEXPND: {
    title: "Federal Government Current Expenditures",
    source: "U.S. Bureau of Economic Analysis",
    units: "Billions of dollars, quarterly SAAR",
    url: "https://fred.stlouisfed.org/series/FGEXPND",
    official:
      "NIPA federal current expenditures, seasonally adjusted annual rate.",
    why: "Used with interest and receipts to form the primary deficit: (outlays − interest) − receipts.",
  },
  GFDEBTN: {
    title: "Federal Debt: Total Public Debt",
    source: "U.S. Department of the Treasury, Fiscal Service",
    units: "Millions of dollars, quarterly",
    url: "https://fred.stlouisfed.org/series/GFDEBTN",
    official:
      "Total public debt outstanding from the Treasury Bulletin / Fiscal Service, millions of dollars.",
    why: "Lagged Bulletin stock. Fallback when debt-to-the-penny or MSPD has not printed yet. Converted to $bn for the coupon ratio.",
  },
  FYGFDPUN: {
    title: "Federal Debt Held by the Public",
    source: "U.S. Department of the Treasury, Fiscal Service",
    units: "Millions of dollars",
    url: "https://fred.stlouisfed.org/series/FYGFDPUN",
    official:
      "Debt held by the public (excludes intragovernmental holdings).",
    why: "Public float, not the Social Security trust-fund circularity. Context for what the market has to roll.",
  },
  GFDEGDQ188S: {
    title: "Federal Debt: Total Public Debt as Percent of Gross Domestic Product",
    source: "U.S. Office of Management and Budget / BEA via FRED",
    units: "Percent of GDP, quarterly",
    url: "https://fred.stlouisfed.org/series/GFDEGDQ188S",
    official:
      "Total public debt divided by GDP, percent.",
    why: "Scale check. Not a wire. Lets a reader see the stock ratio next to the flow wires.",
  },
  UNRATE: {
    title: "Unemployment Rate",
    source: "U.S. Bureau of Labor Statistics",
    units: "Percent, monthly SA",
    url: "https://fred.stlouisfed.org/series/UNRATE",
    official:
      "Civilian unemployment rate, U-3 definition.",
    why: "Labor slack for the F3 story. Primary deficit is only “not in a hole” if the economy is not already in one. Paired with NROU.",
  },
  NROU: {
    title: "Noncyclical Rate of Unemployment",
    source: "U.S. Congressional Budget Office",
    units: "Percent, quarterly NSA",
    url: "https://fred.stlouisfed.org/series/NROU",
    official:
      "CBO renamed this from “Natural Rate of Unemployment (Long-Term)” in 2021. The unemployment rate arising from all sources except fluctuations in aggregate demand. Estimates of potential GDP use this long-term rate.",
    why: "UNRATE − NROU is the unemployment gap stored with metric 3. F3’s “not in a hole” clause.",
  },
  GDP: {
    title: "Gross Domestic Product",
    source: "U.S. Bureau of Economic Analysis",
    units: "Billions of dollars, quarterly SAAR",
    url: "https://fred.stlouisfed.org/series/GDP",
    official:
      "Nominal GDP, seasonally adjusted annual rate.",
    why: "Denominator of primary deficit / GDP (F3) and of nominal growth in r−g.",
  },
  GDPC1: {
    title: "Real Gross Domestic Product",
    source: "U.S. Bureau of Economic Analysis",
    units: "Billions of chained 2017 dollars, quarterly SAAR",
    url: "https://fred.stlouisfed.org/series/GDPC1",
    official:
      "Real GDP, chained dollars, seasonally adjusted annual rate.",
    why: "With GDPPOT, output gap stored on metric 3. Second reading of “is the economy in a hole.”",
  },
  GDPPOT: {
    title: "Real Potential Gross Domestic Product",
    source: "U.S. Congressional Budget Office",
    units: "Billions of chained 2017 dollars, quarterly",
    url: "https://fred.stlouisfed.org/series/GDPPOT",
    official:
      "CBO estimate of the trend level of real GDP consistent with stable inflation, given the noncyclical unemployment rate and capital stock.",
    why: "Denominator of the output-gap companion on metric 3.",
  },
  THREEFYTP10: {
    title: "Term Premium on a 10 Year Zero Coupon Bond",
    source: "Board of Governors of the Federal Reserve System (US)",
    units: "Percent, daily NSA",
    url: "https://fred.stlouisfed.org/series/THREEFYTP10",
    official:
      "Kim and Wright (2005): three-factor arbitrage-free term structure fitted to Treasury yields since 1990, to recover long-term yields, distant-horizon forward rates, and term premiums. (Cube comments sometimes call this ACM; the FRED id we fetch is the Kim-Wright series.)",
    why: "Characteristic long-rate series for a later Fed plot (term premium). Not a Treasury-cube axis.",
  },
  T10Y2Y: {
    title: "10-Year Treasury Constant Maturity Minus 2-Year Treasury Constant Maturity",
    source: "Federal Reserve Bank of St. Louis",
    units: "Percent, daily NSA",
    url: "https://fred.stlouisfed.org/series/T10Y2Y",
    official:
      "Spread constructed by FRED from DGS10 minus DGS2.",
    why: "Curve shape next to the term premium. Inversion vs a fat premium are different duration stories. Raw only.",
  },
  T10Y3M: {
    title: "10-Year Treasury Constant Maturity Minus 3-Month Treasury Constant Maturity",
    source: "Federal Reserve Bank of St. Louis",
    units: "Percent, daily NSA",
    url: "https://fred.stlouisfed.org/series/T10Y3M",
    official:
      "Spread constructed by FRED from the 10-year constant maturity minus the 3-month constant maturity.",
    why: "Policy-to-long spread. Companion to T10Y2Y. Raw only.",
  },
  NFCI: {
    title: "Chicago Fed National Financial Conditions Index",
    source: "Federal Reserve Bank of Chicago",
    units: "Index, weekly ending Friday, NSA",
    url: "https://fred.stlouisfed.org/series/NFCI",
    official:
      "Weekly update on U.S. financial conditions in money, debt, equity, and traditional and shadow banking. Positive values = tighter than average; negative = looser than average.",
    why: "Financial conditions level. Raw series for later work. Not a Treasury-cube axis.",
  },
  DRTSCILM: {
    title: "Net Percentage of Domestic Banks Tightening Standards for Commercial and Industrial Loans to Large and Middle-Market Firms",
    source: "Board of Governors of the Federal Reserve System (US)",
    units: "Percent, quarterly NSA",
    url: "https://fred.stlouisfed.org/series/DRTSCILM",
    official:
      "SLOOS: net share of domestic banks tightening C&I standards for large and middle-market firms.",
    why: "Bank-credit tightness next to NFCI. Raw only. Not a fiscal wire.",
  },
  BAMLC0A0CM: {
    title: "ICE BofA US Corporate Index Option-Adjusted Spread",
    source: "Ice Data Indices, LLC",
    units: "Percent, daily NSA",
    url: "https://fred.stlouisfed.org/series/BAMLC0A0CM",
    official:
      "Option-adjusted spread of the ICE BofA US Corporate Index over a spot Treasury curve. Investment-grade credit premium.",
    why: "IG OAS companion to NFCI. Raw only.",
  },
  BAMLH0A0HYM2: {
    title: "ICE BofA US High Yield Index Option-Adjusted Spread",
    source: "Ice Data Indices, LLC",
    units: "Percent, daily NSA",
    url: "https://fred.stlouisfed.org/series/BAMLH0A0HYM2",
    official:
      "Option-adjusted spread of the ICE BofA US High Yield Index over a spot Treasury curve.",
    why: "HY OAS companion to NFCI. Raw only.",
  },
  PCEPILFE: {
    title: "Personal Consumption Expenditures Excluding Food and Energy (Chain-Type Price Index)",
    source: "U.S. Bureau of Economic Analysis",
    units: "Index 2017=100, monthly SA",
    url: "https://fred.stlouisfed.org/series/PCEPILFE",
    official:
      "BEA core PCE price index. Fed’s preferred underlying inflation gauge. Food and energy excluded.",
    why: "Fed’s preferred inflation gauge. Stored as a level; the mandate plot will use 12-month % vs 2%. Not a Treasury-cube axis.",
  },
  PCEPI: {
    title: "Personal Consumption Expenditures: Chain-Type Price Index",
    source: "U.S. Bureau of Economic Analysis",
    units: "Index 2017=100, monthly SA",
    url: "https://fred.stlouisfed.org/series/PCEPI",
    official:
      "Headline PCE price index, chained.",
    why: "Headline PCE. Stored for the Fed-mandate plot (12-month % minus the 2% goal). Not a Treasury-cube axis.",
  },
  CPILFESL: {
    title: "Consumer Price Index for All Urban Consumers: All Items Less Food and Energy in U.S. City Average",
    source: "U.S. Bureau of Labor Statistics",
    units: "Index 1982-84=100, monthly SA",
    url: "https://fred.stlouisfed.org/series/CPILFESL",
    official:
      "CPI-U excluding food and energy, seasonally adjusted.",
    why: "Second inflation print. Not in the two-force map; kept so core CPI and core PCE can be compared.",
  },
  MSPD_NOTES_PUBLIC_MN: {
    title: "Marketable Treasury notes held by the public",
    source: "U.S. Treasury Fiscal Data — Monthly Statement of the Public Debt, Table 1",
    units: "Millions of dollars, monthly",
    url: "https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/summary-of-treasury-securities-outstanding",
    official:
      "MSPD Table 1, security class Notes, debt held by the public. Original maturity 2–10 years, not remaining life.",
    why: "Largest coupon class. Share of marketable is the time-varying note weight for the mix plot on scratch.",
  },
  MSPD_BONDS_PUBLIC_MN: {
    title: "Marketable Treasury bonds held by the public",
    source: "U.S. Treasury Fiscal Data — Monthly Statement of the Public Debt, Table 1",
    units: "Millions of dollars, monthly",
    url: "https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/summary-of-treasury-securities-outstanding",
    official:
      "MSPD Table 1, security class Bonds, debt held by the public. Original maturity 20–30 years.",
    why: "Long original-maturity coupon stock. Not remaining life — a 20-year with two years left is still a Bond here.",
  },
  MSPD_TIPS_PUBLIC_MN: {
    title: "Marketable TIPS held by the public",
    source: "U.S. Treasury Fiscal Data — Monthly Statement of the Public Debt, Table 1",
    units: "Millions of dollars, monthly",
    url: "https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/summary-of-treasury-securities-outstanding",
    official:
      "MSPD Table 1, Treasury Inflation-Protected Securities, debt held by the public.",
    why: "Inflation-linked stock. Kept as its own mix bucket so it is not dumped into notes or bonds.",
  },
  MSPD_FRN_PUBLIC_MN: {
    title: "Marketable floating-rate notes held by the public",
    source: "U.S. Treasury Fiscal Data — Monthly Statement of the Public Debt, Table 1",
    units: "Millions of dollars, monthly",
    url: "https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/summary-of-treasury-securities-outstanding",
    official:
      "MSPD Table 1, Floating Rate Notes, debt held by the public. Series begins when FRNs exist (2014).",
    why: "Resets off the bill. Own mix bucket. Missing before issuance is a real zero-stock, not a hole in Table 1.",
  },
  MSPD_NOTES_SHARE_MARKETABLE: {
    title: "Notes as a share of marketable debt held by the public",
    source: "Derived from MSPD Table 1",
    units: "Ratio",
    url: "https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/summary-of-treasury-securities-outstanding",
    official: "MSPD_NOTES_PUBLIC_MN / MSPD_MARKETABLE_PUBLIC_MN.",
    why: "Time-varying original-class weight. Scratch mix plot. Not yet the published refi weights.",
  },
  MSPD_BONDS_SHARE_MARKETABLE: {
    title: "Bonds as a share of marketable debt held by the public",
    source: "Derived from MSPD Table 1",
    units: "Ratio",
    url: "https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/summary-of-treasury-securities-outstanding",
    official: "MSPD_BONDS_PUBLIC_MN / MSPD_MARKETABLE_PUBLIC_MN.",
    why: "Time-varying original-class weight. Scratch mix plot.",
  },
  MSPD_TIPS_SHARE_MARKETABLE: {
    title: "TIPS as a share of marketable debt held by the public",
    source: "Derived from MSPD Table 1",
    units: "Ratio",
    url: "https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/summary-of-treasury-securities-outstanding",
    official: "MSPD_TIPS_PUBLIC_MN / MSPD_MARKETABLE_PUBLIC_MN.",
    why: "Time-varying original-class weight. Scratch mix plot.",
  },
  MSPD_FRN_SHARE_MARKETABLE: {
    title: "FRNs as a share of marketable debt held by the public",
    source: "Derived from MSPD Table 1",
    units: "Ratio",
    url: "https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/summary-of-treasury-securities-outstanding",
    official: "MSPD_FRN_PUBLIC_MN / MSPD_MARKETABLE_PUBLIC_MN.",
    why: "Time-varying original-class weight. Scratch mix plot.",
  },
  MSPD_BILLS_PUBLIC_MN: {
    title: "Marketable Treasury bills held by the public",
    source: "U.S. Treasury Fiscal Data — Monthly Statement of the Public Debt, Table 1",
    units: "Millions of dollars, monthly",
    url: "https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/summary-of-treasury-securities-outstanding",
    official:
      "MSPD Table 1, security class Bills, debt held by the public. Constructed in cube_data.fetch_mspd_composition.",
    why: "Numerator of bills / marketable. A fat bill share means the coupon wall rolls fast when funds moves.",
  },
  MSPD_MARKETABLE_PUBLIC_MN: {
    title: "Total marketable Treasury debt held by the public",
    source: "U.S. Treasury Fiscal Data — Monthly Statement of the Public Debt, Table 1",
    units: "Millions of dollars, monthly",
    url: "https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/summary-of-treasury-securities-outstanding",
    official:
      "MSPD Table 1, Total Marketable, debt held by the public.",
    why: "Denominator of the bills share used on metric 1.",
  },
  MSPD_TOTAL_DEBT_MN: {
    title: "Total public debt outstanding (MSPD)",
    source: "U.S. Treasury Fiscal Data — Monthly Statement of the Public Debt, Table 1",
    units: "Millions of dollars, monthly",
    url: "https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/summary-of-treasury-securities-outstanding",
    official:
      "MSPD Table 1 total public debt outstanding, millions of dollars.",
    why: "Middle-priority debt stock for the effective coupon: penny first, then MSPD, then GFDEBTN.",
  },
  MSPD_BILLS_SHARE_MARKETABLE: {
    title: "Bills as a share of marketable debt held by the public",
    source: "Derived from MSPD Table 1",
    units: "Ratio",
    url: "https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/summary-of-treasury-securities-outstanding",
    official:
      "MSPD_BILLS_PUBLIC_MN / MSPD_MARKETABLE_PUBLIC_MN. Not a FRED series.",
    why: "How much of the book reprices when the funds rate moves. Input to the F1 story.",
  },
  DEBT_HELD_PUBLIC: {
    title: "Debt Held by the Public",
    source: "U.S. Treasury Fiscal Data — Debt to the Penny",
    units: "U.S. dollars, daily",
    url: "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/debt-to-the-penny",
    official:
      "Daily debt held by the public from Debt to the Penny (debt_held_public_amt).",
    why: "Public stock at daily frequency. Preferred over the Bulletin when it exists.",
  },
  DEBT_INTRAGOV: {
    title: "Intragovernmental Holdings",
    source: "U.S. Treasury Fiscal Data — Debt to the Penny",
    units: "U.S. dollars, daily",
    url: "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/debt-to-the-penny",
    official:
      "Daily intragovernmental holdings (intragov_hold_amt).",
    why: "The part of the total that is not the public float. Split out so DEBT_TOTAL is inspectable.",
  },
  DEBT_TOTAL: {
    title: "Total Public Debt Outstanding",
    source: "U.S. Treasury Fiscal Data — Debt to the Penny",
    units: "U.S. dollars, daily",
    url: "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/debt-to-the-penny",
    official:
      "Daily total public debt outstanding (tot_pub_debt_out_amt).",
    why: "Preferred stock for interest / debt in F1 and r−g. Converted to $bn; latest official print wins the date.",
  },
  DFII10: {
    title: "Market Yield on U.S. Treasury Securities at 10-Year Constant Maturity, Quoted on an Investment Basis, Inflation-Indexed",
    source: "Board of Governors of the Federal Reserve System (US)",
    units: "Percent, daily NSA",
    url: "https://fred.stlouisfed.org/series/DFII10",
    official:
      "10-year TIPS real yield from the Treasury H.15 constant-maturity curve.",
    why: "Real long rate the FOMC means when it talks about moderate long-term rates. Stored raw for the Fed plot. Not a Treasury-cube axis.",
  },
  DGS30: {
    title: "Market Yield on U.S. Treasury Securities at 30-Year Constant Maturity, Quoted on an Investment Basis",
    source: "Board of Governors of the Federal Reserve System (US)",
    units: "Percent, daily NSA",
    url: "https://fred.stlouisfed.org/series/DGS30",
    official:
      "Treasury constant-maturity 30-year yield from the H.15 / Treasury yield curve methodology.",
    why: "Back of the curve next to DGS10. Context for duration and the long-rate mandate, not a cube wire.",
  },
  DFEDTARU: {
    title: "Federal Funds Target Range — Upper Limit",
    source: "Board of Governors of the Federal Reserve System (US)",
    units: "Percent, daily NSA",
    url: "https://fred.stlouisfed.org/series/DFEDTARU",
    official:
      "Upper limit of the FOMC federal funds target range. Series begins December 2008 when the Committee switched to a range.",
    why: "What the Committee set, not a mandate gap. Overlay for a later “what they did” plot. Not used in the Treasury cubes.",
  },
  DFEDTARL: {
    title: "Federal Funds Target Range — Lower Limit",
    source: "Board of Governors of the Federal Reserve System (US)",
    units: "Percent, daily NSA",
    url: "https://fred.stlouisfed.org/series/DFEDTARL",
    official:
      "Lower limit of the FOMC federal funds target range. Series begins December 2008.",
    why: "Companion to DFEDTARU. Instrument path, not a goal. Stored raw only.",
  },
  PAYEMS: {
    title: "All Employees, Total Nonfarm",
    source: "U.S. Bureau of Labor Statistics",
    units: "Thousands of persons, monthly SA",
    url: "https://fred.stlouisfed.org/series/PAYEMS",
    official:
      "Total nonfarm payroll employment from the Current Employment Statistics survey, seasonally adjusted.",
    why: "The jobs print the public hears. Check series for the Fed plot, not the employment axis — that axis will be UNRATE vs NROU so one print cannot move the cube.",
  },
  JTSJOL: {
    title: "Job Openings: Total Nonfarm",
    source: "U.S. Bureau of Labor Statistics",
    units: "Level in thousands, monthly SA",
    url: "https://fred.stlouisfed.org/series/JTSJOL",
    official:
      "JOLTS total nonfarm job openings, seasonally adjusted. Starts December 2000.",
    why: "Labor-market tightness beyond the unemployment gap. Stored for the Fed plot. Post-2000 only.",
  },
  T5YIE: {
    title: "5-Year Breakeven Inflation Rate",
    source: "Federal Reserve Bank of St. Louis",
    units: "Percent, daily NSA",
    url: "https://fred.stlouisfed.org/series/T5YIE",
    official:
      "Difference between 5-year Treasury and 5-year TIPS yields. Market-implied average inflation over five years.",
    why: "Near-term inflation expectation the Board cites. Stored raw for the Fed plot. Not a Treasury-cube axis.",
  },
  T10YIE: {
    title: "10-Year Breakeven Inflation Rate",
    source: "Federal Reserve Bank of St. Louis",
    units: "Percent, daily NSA",
    url: "https://fred.stlouisfed.org/series/T10YIE",
    official:
      "Difference between 10-year Treasury and 10-year TIPS yields. Market-implied average inflation over ten years.",
    why: "Longer breakeven next to T5YIE. Stored raw for the Fed plot.",
  },
  T5YIFR: {
    title: "5-Year, 5-Year Forward Inflation Expectation Rate",
    source: "Federal Reserve Bank of St. Louis",
    units: "Percent, daily NSA",
    url: "https://fred.stlouisfed.org/series/T5YIFR",
    official:
      "Market-implied inflation five years forward for five years. Closest market stand-in for whether 2% is anchored.",
    why: "Anchoring check for the inflation mandate. Stored raw. Not a cube wire.",
  },
  CPIAUCSL: {
    title: "Consumer Price Index for All Urban Consumers: All Items in U.S. City Average",
    source: "U.S. Bureau of Labor Statistics",
    units: "Index 1982-84=100, monthly SA",
    url: "https://fred.stlouisfed.org/series/CPIAUCSL",
    official:
      "Headline CPI-U, seasonally adjusted.",
    why: "Public inflation print. Robustness next to PCE. The Fed plot’s inflation axis will be PCE, not CPI.",
  },
  MICH: {
    title: "University of Michigan: Inflation Expectation",
    source: "University of Michigan, Survey of Consumers",
    units: "Percent, monthly NSA",
    url: "https://fred.stlouisfed.org/series/MICH",
    official:
      "Median expected price change over the next 12 months from the University of Michigan Survey of Consumers.",
    why: "Household inflation expectation the FOMC still mentions. Soft series. Stored raw for the Fed plot.",
  },
  PCETRIM12M159SFRBDAL: {
    title: "Trimmed Mean PCE Inflation Rate",
    source: "Federal Reserve Bank of Dallas",
    units: "Percent change from year ago, monthly SA",
    url: "https://fred.stlouisfed.org/series/PCETRIM12M159SFRBDAL",
    official:
      "Dallas Fed 12-month trimmed-mean PCE inflation. Already a rate, not an index.",
    why: "Underlying PCE the briefings use when headline and core disagree. Stored raw. Not a Treasury-cube axis.",
  },
  DGS5: {
    title: "Market Yield on U.S. Treasury Securities at 5-Year Constant Maturity",
    source: "Board of Governors of the Federal Reserve System (US)",
    units: "Percent, daily, NSA",
    url: "https://fred.stlouisfed.org/series/DGS5",
    official: "Treasury constant-maturity 5-year yield from the H.15 curve.",
    why: "Stand-in for remaining life 3–7 years on the Table 3 residual marginal rate.",
  },
  RESID_W_0_1Y: {
    title: "Share of marketable stock with remaining life under 1 year",
    source: "U.S. Treasury Fiscal Data — MSPD Table 3 market (CUSIP detail, collapsed)",
    units: "Ratio of outstanding (+ issued if outstanding missing)",
    url: "https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/detail-of-marketable-treasury-securities-outstanding",
    official: "Sum of CUSIP principal with maturity − record_date < 1 year, divided by sum of bucketed principal that month. TIPS and FRNs are their own buckets.",
    why: "Remaining-maturity weight. Priced off TB3MS for residual m_t.",
  },
  RESID_W_1_3Y: {
    title: "Share of marketable stock with remaining life 1–3 years",
    source: "U.S. Treasury Fiscal Data — MSPD Table 3 market",
    units: "Ratio",
    url: "https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/detail-of-marketable-treasury-securities-outstanding",
    official: "Residual maturity in [1, 3) years. Nominal notes/bonds/bills only.",
    why: "Priced off DGS2.",
  },
  RESID_W_3_7Y: {
    title: "Share of marketable stock with remaining life 3–7 years",
    source: "U.S. Treasury Fiscal Data — MSPD Table 3 market",
    units: "Ratio",
    url: "https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/detail-of-marketable-treasury-securities-outstanding",
    official: "Residual maturity in [3, 7) years.",
    why: "Priced off DGS5.",
  },
  RESID_W_7_10Y: {
    title: "Share of marketable stock with remaining life 7–10 years",
    source: "U.S. Treasury Fiscal Data — MSPD Table 3 market",
    units: "Ratio",
    url: "https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/detail-of-marketable-treasury-securities-outstanding",
    official: "Residual maturity in [7, 10) years.",
    why: "Priced off DGS10.",
  },
  RESID_W_10YPLUS: {
    title: "Share of marketable stock with remaining life 10 years or more",
    source: "U.S. Treasury Fiscal Data — MSPD Table 3 market",
    units: "Ratio",
    url: "https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/detail-of-marketable-treasury-securities-outstanding",
    official: "Residual maturity ≥ 10 years, nominal.",
    why: "Priced off DGS30.",
  },
  RESID_W_TIPS: {
    title: "Share of marketable stock that is TIPS (any remaining life)",
    source: "U.S. Treasury Fiscal Data — MSPD Table 3 market",
    units: "Ratio",
    url: "https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/detail-of-marketable-treasury-securities-outstanding",
    official: "Inflation-indexed / TIPS CUSIPs, not dumped into a nominal tenor.",
    why: "Priced off DFII10. Months before DFII10 exist leave residual m_t blank if this weight is positive.",
  },
  RESID_W_FRN: {
    title: "Share of marketable stock that is FRNs (any remaining life)",
    source: "U.S. Treasury Fiscal Data — MSPD Table 3 market",
    units: "Ratio",
    url: "https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/detail-of-marketable-treasury-securities-outstanding",
    official: "Floating-rate notes. Reset is not remaining final maturity.",
    why: "Priced off FEDFUNDS.",
  },
};
