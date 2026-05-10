import React from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Container,
  Divider,
  Grid,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { Header } from '@/components/Header/Header';
import { Footer } from '@/components/Footer/Footer';
import { GradientLine } from '@/components/GradientLine';
import { ScrollTopFab } from '@/components/ScrollTopFab/ScrollTopFab';
import { PageWrapper } from '@/components/PageWrapper';
import { Seo, SITE_NAME } from '@/components/Seo';
import { breadcrumbList } from '@/lib/structuredData';
import { NextMuiLink } from '@/components/NextMuiLink';
import { Contents } from './Contents';

const CONTACT_EMAIL = 'gridcat@gridcoin.club';
const GOVERNING_LAW = '[Operator’s principal place of business]';
const EFFECTIVE_DATE = '2026-05-07';

const capsMono = {
  fontFamily: 'var(--font-mono, monospace)',
  textTransform: 'uppercase',
  fontSize: 13,
  lineHeight: 1.6,
} as const;

export function Page() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <>
      <Seo
        title={`${SITE_NAME} :: Terms of Service`}
        description="Terms of Service, disclaimer, and acceptable-use policy for GRCpay and the public grcpay.gridcoin.club instance."
        path="/disclaimer"
        ogType="article"
        jsonLd={{
          '@context': 'https://schema.org',
          '@graph': [
            breadcrumbList([
              { name: 'Home', path: '/' },
              { name: 'Terms of Service', path: '/disclaimer' },
            ]),
          ],
        }}
      />
      <PageWrapper>
        <Header />
        <Container maxWidth="xl" sx={{ flexGrow: 1 }}>
          <GradientLine />
          <Grid container spacing={3}>
            <Grid size={{ sm: 3, xs: 12 }} sx={{ display: isMobile ? 'none' : 'flex' }}>
              <Contents />
            </Grid>
            <Grid size={{ sm: 9, xs: 12 }}>
              <Box sx={{ pb: 2 }}>
                <Typography component="h1" variant="h4" sx={{ pb: 1 }}>
                  Terms of Service
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  The contract, the disclaimer, and the acceptable-use
                  policy for GRCpay and the public
                  {' '}
                  <code>grcpay.gridcoin.club</code>
                  {' '}
                  instance. Read it carefully before relying on
                  anything you see here or pointing real customer
                  payments at this software.
                </Typography>
              </Box>

              <Box id="acceptance" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  Read this first
                </Typography>
                <Typography gutterBottom variant="body1">
                  These Terms cover your use of GRCpay (the open-source
                  software published at
                  {' '}
                  <NextMuiLink
                    href="https://github.com/gridcoin-community/grcpay.gridcoin.club"
                    rel="external noopener"
                    color="primary"
                  >
                    github.com/gridcoin-community/grcpay.gridcoin.club
                  </NextMuiLink>
                  ) and any instance you reach through this site,
                  including the demo at
                  {' '}
                  <code>grcpay.gridcoin.club</code>
                  . By using the software, the public instance, the
                  API, the WordPress / WooCommerce plugin, or any
                  other component shipped under the GRCpay name, you
                  agree to these Terms. If you do not agree, do not
                  use them.
                </Typography>
                <Typography gutterBottom variant="body1">
                  Where the law requires capital letters or specific
                  phrasing for enforceability, we have used them.
                  Everywhere else we have tried to keep the language
                  plain.
                </Typography>
              </Box>

              <Box id="facilitator" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  A passive facilitator
                </Typography>
                <Typography gutterBottom variant="body1">
                  GRCpay is a small payment facilitator. It mints one-shot
                  Gridcoin addresses, watches the public Gridcoin
                  blockchain for incoming funds, and (if a recipient was
                  specified) forwards those funds onward. We do not
                  author, curate, moderate, or endorse the transactions
                  that flow through addresses minted by this software.
                </Typography>

                <Typography variant="h6" component="h3" id="immutable" sx={{ pt: 2, pb: 1 }}>
                  On-chain payments are final
                </Typography>
                <Typography gutterBottom variant="body1">
                  The Gridcoin blockchain is a permissionless, distributed
                  ledger maintained by independent nodes worldwide. Once a
                  transaction has been confirmed by the network, nobody
                  (including the operators of this service) can rewrite,
                  redact, or reverse it. Refunds, when they
                  happen, are best-effort outbound transactions to the
                  apparent sender; they are not chargebacks and they are
                  not guaranteed.
                </Typography>
              </Box>

              <Box id="not" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  What we are not
                </Typography>
                <Typography gutterBottom variant="body1">
                  Neither the operator of the public instance nor the
                  maintainers of the GRCpay software are, in any
                  jurisdiction:
                </Typography>
                <Box component="ul" sx={{ pl: 3, mt: 0 }}>
                  <Typography component="li" variant="body1" gutterBottom>
                    a registered Money Services Business or money
                    transmitter under the US Bank Secrecy Act, FinCEN
                    regulations, or any state Money Transmitter
                    regime;
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    an authorised Crypto-Asset Service Provider (CASP)
                    under EU Regulation 2023/1114 (MiCA), nor a
                    legacy-VASP under any Member-State regime;
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    a payment institution, e-money institution, or
                    credit institution under PSD2/PSD3, EMD2, or any
                    national equivalent;
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    a registered cryptoasset business with the UK
                    Financial Conduct Authority, a licensed digital
                    payment token service provider with the Monetary
                    Authority of Singapore, a FINMA-supervised
                    Swiss financial intermediary, or a VARA-licensed
                    UAE virtual asset service provider;
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    a custodian, exchange, broker, dealer, market
                    maker, escrow agent, settlement provider, or
                    notary;
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    a provider of legal, tax, accounting, or
                    investment advice.
                  </Typography>
                </Box>
                <Typography gutterBottom variant="body1">
                  GRCpay is open-source software you can audit, fork,
                  and run yourself. The public instance is a courtesy
                  demo, not a regulated service.
                </Typography>
              </Box>

              <Box id="public-instance" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  The public instance
                </Typography>
                <Typography gutterBottom variant="body1">
                  We run a public copy of GRCpay at
                  {' '}
                  <code>https://grcpay.gridcoin.club/api</code>
                  {' '}
                  as a courtesy, so people can try the protocol
                  without standing up their own stack first. The
                  {' '}
                  <NextMuiLink href="/demo" color="primary">live demo</NextMuiLink>
                  {' '}
                  on this site uses that same instance, and the
                  WordPress / WooCommerce plugin lets developers point
                  it at the public instance during evaluation.
                </Typography>
                <Alert severity="warning" variant="outlined" sx={{ my: 2 }}>
                  <AlertTitle>No SLA, no uptime guarantee, no warranty</AlertTitle>
                  The public
                  {' '}
                  <code>grcpay.gridcoin.club</code>
                  {' '}
                  install may go down, change behaviour, lose pending
                  state, or be retired without notice. If you choose
                  to depend on it for real customer payments, you do
                  so entirely at your own risk and contrary to these
                  Terms (see <i>Production use is prohibited</i>{' '}
                  immediately below).
                </Alert>

                <Typography variant="h6" component="h3" id="no-production" sx={{ pt: 2, pb: 1 }}>
                  Production use is prohibited
                </Typography>
                <Typography gutterBottom variant="body1">
                  The public instance is provided for evaluation,
                  testing, demos, and small-scale personal experiments
                  only. <b>Production use of the public instance to
                  accept real customer payments on a commercial basis
                  is contrary to these Terms.</b>
                  {' '}
                  Production use includes (without limitation): wiring
                  the public instance into a live ecommerce checkout,
                  invoicing, point-of-sale, donation page, or any
                  other recurring revenue flow above hobbyist scale.
                </Typography>
                <Typography gutterBottom variant="body1">
                  The operator may impose rate limits, volume caps,
                  per-IP throttling, allowlists, or geographic
                  restrictions on the public instance at any time and
                  without notice, and may refuse, gate, or terminate
                  any usage that resembles production. The operator
                  may also retire the public instance entirely at any
                  point. None of those actions create any liability
                  toward you.
                </Typography>
                <Typography gutterBottom variant="body1">
                  Before going to production, switch to a self-hosted
                  GRCpay against your own Gridcoin wallet. The
                  {' '}
                  <NextMuiLink href="/self-hosting" color="primary">self-hosting guide</NextMuiLink>
                  {' '}
                  is the canonical setup, not a fallback.
                </Typography>
                <Alert severity="info" variant="outlined" sx={{ my: 2 }}>
                  <AlertTitle>Free for now</AlertTitle>
                  Use of the public instance, within the evaluation
                  scope above, is currently
                  {' '}
                  <strong>free of charge</strong>
                  . If load gets heavy enough that it becomes a
                  problem for the ecosystem, we may revisit this — for
                  example by tightening rate limits, adding a paid
                  tier, or moving to an allowlist. Self-hosters are
                  unaffected by any of that.
                </Alert>
              </Box>

              <Box id="custody" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  Custody &amp; self-hosting
                </Typography>
                <Typography gutterBottom variant="body1">
                  When you self-host GRCpay against a Gridcoin wallet
                  you control, the service is non-custodial in the
                  meaningful sense: customer funds never touch our
                  wallet, our database, or our infrastructure. The
                  keys, the wallet file, and any tradeoffs around
                  hot/cold splits are entirely yours to manage.
                </Typography>
                <Typography gutterBottom variant="body1">
                  When you point integrations at the public instance,
                  funds briefly transit a wallet operated by us before
                  being forwarded to the
                  {' '}
                  <code>recipient</code>
                  {' '}
                  address you specify. We make no representations about
                  the security or longevity of that hot wallet, and we
                  cannot reimburse losses arising from compromise, key
                  loss, network failure, software bugs, or anything
                  else. For production usage, follow the
                  {' '}
                  <NextMuiLink href="/self-hosting#hot-cold" color="primary">
                    hot/cold wallet pattern
                  </NextMuiLink>
                  {' '}
                  on infrastructure you own.
                </Typography>
              </Box>

              <Box id="plugins" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  Plugins &amp; integrations
                </Typography>
                <Typography gutterBottom variant="body1">
                  The WordPress / WooCommerce plugin and any other
                  ecommerce integration we publish under the
                  gridcat or gridcoin-community organisations are
                  released under the MIT licence. The plugin&apos;s
                  default configuration is &ldquo;point at a
                  GRCpay endpoint you operate&rdquo; — not the public
                  instance. Pointing a plugin install at the public
                  instance for production checkout is contrary to
                  these Terms (see above).
                </Typography>
                <Typography gutterBottom variant="body1">
                  When you install a GRCpay plugin into your
                  storefront, the plugin is a thin client that talks
                  to whichever GRCpay endpoint you configure.
                  Responsibility for AML, KYC, sanctions screening,
                  Travel-Rule compliance, tax, accounting, customer
                  service, and dispute handling lives with you as the
                  merchant — not with the plugin authors and not with
                  the maintainers of the GRCpay endpoint software.
                </Typography>
              </Box>

              <Box id="eligibility" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  Eligibility &amp; sanctions
                </Typography>
                <Typography gutterBottom variant="body1">
                  By using GRCpay or the public instance, you
                  represent and warrant that:
                </Typography>
                <Box component="ul" sx={{ pl: 3, mt: 0 }}>
                  <Typography component="li" variant="body1" gutterBottom>
                    you are at least 18 years old (or the legal age
                    of majority in your jurisdiction, whichever is
                    greater);
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    you are not a resident of, located in, or a
                    national of any country or region subject to
                    comprehensive sanctions imposed by the United
                    Nations, European Union, United Kingdom,
                    Switzerland, or United States, including but not
                    limited to North Korea, Iran, Cuba, Syria, the
                    Crimea region, and the so-called Donetsk,
                    Luhansk, Kherson, and Zaporizhzhia
                    People&rsquo;s Republics;
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    you are not listed on, or owned or controlled by
                    a person listed on, any sanctions list maintained
                    by the authorities above, including the OFAC SDN
                    List, HM Treasury OFSI Consolidated List, and the
                    EU Consolidated Sanctions List;
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    using GRCpay is lawful in your jurisdiction; and
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    you have full legal capacity to be bound by these
                    Terms.
                  </Typography>
                </Box>
              </Box>

              <Box id="prohibited" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  Prohibited use
                </Typography>
                <Typography gutterBottom variant="body1">
                  You agree not to use GRCpay or the public instance:
                </Typography>
                <Box component="ul" sx={{ pl: 3, mt: 0 }}>
                  <Typography component="li" variant="body1" gutterBottom>
                    to send, receive, or facilitate payments
                    involving any sanctioned person, entity, vessel,
                    or jurisdiction;
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    to process funds you know or reasonably suspect
                    are proceeds of crime, of fraud, of corruption, of
                    sanctions evasion, of human trafficking, or of
                    any other criminal activity;
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    to accept payment for goods or services that are
                    illegal in any jurisdiction relevant to the
                    transaction (yours, the customer&rsquo;s, or any
                    transit jurisdiction), including controlled drugs,
                    unlicensed pharmaceuticals, weapons, child sexual
                    abuse material, non-consensual intimate imagery,
                    counterfeit goods, IP-infringing digital media
                    sold as legitimate, hacking-as-a-service, malware,
                    forged documents, identity documents, or
                    trafficked human remains, organs, or labour;
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    to operate an unregulated exchange, mixer, money
                    transmitter, money services business, payment
                    institution, e-money institution, gambling
                    platform, or securities offering through GRCpay;
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    to evade taxes, customs duties, or
                    Travel-Rule / DAC8 / FATF Recommendation 16
                    obligations applicable to you;
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    to launch, assist, or facilitate denial-of-service
                    against the public instance, the Gridcoin
                    network, any wallet daemon, fiat-rate provider,
                    or any other dependency;
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    to defraud, mislead, or extract value from the
                    public instance&rsquo;s hot wallet, including by
                    creating wallets in volumes calculated to drain
                    fee budgets, by replaying transactions, by
                    exploiting timing windows, or by any other abuse
                    of the API.
                  </Typography>
                </Box>
                <Typography gutterBottom variant="body1">
                  The operator may refuse, rate-limit, gate, or
                  terminate any access for actual, suspected, or
                  pattern-of-conduct violations of this section, with
                  or without notice. The operator may also cooperate
                  with valid legal process from competent authorities,
                  including by freezing addresses, holding funds, and
                  disclosing operational data the operator does have.
                </Typography>
              </Box>

              <Box id="merchant-obligations" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  Your own legal obligations
                </Typography>
                <Typography gutterBottom variant="body1">
                  GRCpay is a tool. Running it commercially — whether
                  on the public instance during evaluation, on your
                  own self-hosted instance in production, or anywhere
                  in between — may bring obligations under the laws
                  applicable to you. Those obligations sit with you.
                  GRCpay does not perform any of the following on your
                  behalf:
                </Typography>
                <Box component="ul" sx={{ pl: 3, mt: 0 }}>
                  <Typography component="li" variant="body1" gutterBottom>
                    customer identification (KYC) or beneficial-owner
                    verification under EU AMLR, the US Bank Secrecy
                    Act, the UK MLRs, or any other anti-money-
                    laundering regime;
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    sanctions screening of customer wallet addresses,
                    counterparties, or transit routes against OFAC,
                    EU, UK, UN, or other sanctions lists;
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    Travel-Rule transmission of originator and
                    beneficiary information under EU Regulation
                    2023/1113, FATF Recommendation 16, FinCEN&rsquo;s
                    Travel Rule, or any equivalent regime;
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    crypto-asset reporting under EU Council Directive
                    2023/2226 (DAC8), the US 6045 broker reporting
                    framework, or other tax-information-exchange
                    regimes;
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    VAT, sales tax, GST, withholding tax, or any
                    other indirect or direct tax assessment, return,
                    or remittance arising from your transactions;
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    consumer-protection compliance, including refund,
                    distance-selling, and dispute-resolution rules
                    under EU consumer-protection law, the UK
                    Consumer Rights Act, or equivalent national
                    regimes;
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    licensing, registration, or authorisation under
                    any payment-services, e-money, money-transmitter,
                    cryptoasset, gambling, or sectoral regulatory
                    regime applicable to your activity.
                  </Typography>
                </Box>
                <Typography gutterBottom variant="body1">
                  See the
                  {' '}
                  <NextMuiLink href="/legal" color="primary">legal overview for self-hosters</NextMuiLink>
                  {' '}
                  for an orientation pass; that page is informational
                  and is not legal advice.
                </Typography>
              </Box>

              <Box id="asis" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  Use at your own risk
                </Typography>
                <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>
                  GRCpay is provided <strong>&quot;as is&quot;</strong> and
                  <strong> &quot;as available&quot;</strong>, without
                  warranty of any kind (express, implied, or statutory),
                  including, without limitation, warranties of
                  merchantability, fitness for a particular purpose,
                  accuracy, completeness, title, or non-infringement.
                </Alert>
                <Typography gutterBottom variant="body2" component="p" sx={capsMono}>
                  Without limiting the foregoing, the operator
                  disclaims any warranty that the service will be
                  uninterrupted, error-free, secure, free of malware,
                  resilient against blockchain forks or
                  reorganisations, or that any defect will be
                  corrected. The operator does not warrant the
                  operation, security, or continuity of the Gridcoin
                  network, of any wallet software, of any explorer,
                  fiat-rate provider, hosting provider, or any other
                  third-party dependency.
                </Typography>

                <Typography variant="h6" component="h3" id="accuracy" sx={{ pt: 2, pb: 1 }}>
                  No accuracy guarantee
                </Typography>
                <Typography gutterBottom variant="body1">
                  We do not guarantee that wallet status, balances,
                  exchange rates, QR codes, or any other data presented by
                  GRCpay are correct, current, complete, or free from
                  indexing errors, transient outages, chain-reorg
                  artefacts, or upstream-API hiccups. Fiat-equivalent
                  amounts in particular are derived from third-party
                  pricing data, cached for several minutes, and can drift
                  meaningfully from any market you care about.
                </Typography>
                <Typography gutterBottom variant="body1">
                  Do not rely on GRCpay for financial, legal, accounting,
                  tax, or operational decisions without independent
                  verification. Cross-check anything that matters against
                  a trusted Gridcoin full node before acting on it.
                </Typography>
              </Box>

              <Box id="liability" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  No liability
                </Typography>
                <Typography gutterBottom variant="body2" component="p" sx={capsMono}>
                  To the maximum extent permitted by applicable law,
                  the operators, contributors, and hosts of this
                  service shall not be liable for any direct,
                  indirect, incidental, special, consequential,
                  exemplary, or punitive damages (including, without
                  limitation, lost funds, lost GRC, lost profits,
                  lost data, lost case outcomes, lost opportunities,
                  business interruption, or service disruption)
                  arising out of or in connection with your use of,
                  or inability to use, GRCpay or the public instance,
                  even if advised of the possibility of such damages.
                </Typography>
                <Typography gutterBottom variant="body2" component="p" sx={capsMono}>
                  Without limiting the foregoing, the operator will
                  not be liable for: (i) the acts or omissions of
                  customers, merchants, or any other third party;
                  (ii) loss of funds in transit on the Gridcoin
                  network; (iii) failures, forks, reorgs, or attacks
                  on the Gridcoin network; (iv) outages or errors of
                  grcpay, stamp, the explorer, wallets, fiat-rate
                  providers, hosting providers, or any other
                  third-party tool; (v) consequences of your loss or
                  compromise of private keys, wallet files, recipient
                  addresses, or wallet tokens; (vi) consequences of
                  rate-limiting, refusing, or terminating any usage of
                  the public instance, including production use
                  contrary to these Terms.
                </Typography>
                <Typography gutterBottom variant="body1">
                  Nothing in these Terms excludes or limits liability
                  that cannot lawfully be excluded or limited,
                  including liability for death or personal injury
                  caused by negligence, fraud, fraudulent
                  misrepresentation, or any non-waivable
                  consumer-protection right under the law of your
                  habitual residence. You access and use the service
                  at your sole risk and are solely responsible for any
                  loss or harm that may result.
                </Typography>
              </Box>

              <Box id="no-advice" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  No financial advice
                </Typography>
                <Typography gutterBottom variant="body1">
                  Nothing on this site or returned by the API constitutes
                  financial, investment, trading, tax, legal, or any other
                  form of professional advice. GRC/fiat exchange rates,
                  wallet balances, QR codes, and lifecycle states are
                  presented for informational and operational purposes
                  only. You are solely responsible for any decisions you
                  make using this information, including any decision to
                  accept GRC as payment in the first place.
                </Typography>
              </Box>

              <Box id="indemnification" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  Indemnification
                </Typography>
                <Typography gutterBottom variant="body1">
                  You will defend, indemnify, and hold harmless the
                  operator, the GRCpay maintainers, the gridcoin.club
                  family contributors, and their respective agents
                  from and against any claim, demand, investigation,
                  proceeding, loss, damage, cost, or expense
                  (including reasonable legal fees) arising out of or
                  relating to: (a) your use of GRCpay or the public
                  instance; (b) any content or data you submit through
                  the API or the plugin; (c) any transaction you
                  enter into through GRCpay; (d) your breach of these
                  Terms; (e) your violation of any law, regulation, or
                  third-party right; or (f) any tax, customs, AML,
                  sanctions, or licensing liability arising from your
                  activity.
                </Typography>
                <Typography gutterBottom variant="body1">
                  The operator may, at its option, take exclusive
                  control of the defence and settlement of any claim
                  subject to this section; you will cooperate. You
                  will not settle any claim that imposes any
                  obligation on the operator without the
                  operator&rsquo;s written consent.
                </Typography>
              </Box>

              <Box id="user-content" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  User-supplied data
                </Typography>
                <Typography gutterBottom variant="body1">
                  Callers supply the
                  {' '}
                  <code>recipient</code>
                  {' '}
                  address, the
                  {' '}
                  <code>amountRequired</code>
                  , and any other order-shaped fields when creating a
                  wallet. We do not validate that a recipient address
                  belongs to anyone in particular, and once funds have
                  been forwarded to the address you provided, the
                  transaction is on-chain and final. Funds sent to a
                  mistyped, hostile, or otherwise wrong recipient cannot
                  be recovered by us.
                </Typography>
                <Alert severity="warning" variant="outlined" sx={{ my: 2 }}>
                  <AlertTitle>No recipient = donation</AlertTitle>
                  If you create a wallet on the public instance
                  {' '}
                  <strong>without</strong>
                  {' '}
                  a
                  {' '}
                  <code>recipient</code>
                  , any GRC you send to the minted address lands in the
                  Gridcoin wallet operated by us and is treated as a
                  donation to the public-instance operator. It will not
                  be forwarded anywhere and it will not be refunded. If
                  that is not what you want, supply a
                  {' '}
                  <code>recipient</code>
                  {' '}
                  address you control, or
                  {' '}
                  <NextMuiLink href="/self-hosting" color="primary">
                    self-host
                  </NextMuiLink>
                  {' '}
                  against your own wallet.
                </Alert>
              </Box>

              <Box id="third-parties" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  Third-party services
                </Typography>
                <Typography gutterBottom variant="body1">
                  GRCpay interfaces with third-party software (the
                  Gridcoin Research wallet, fiat-rate providers such as
                  CoinGecko, hosting providers, analytics, and others).
                  Their availability, behaviour, and licensing terms are
                  governed by their own publishers; we make no
                  representations about them and accept no responsibility
                  for their conduct or output.
                </Typography>
              </Box>

              <Box id="governing-law" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  Governing law
                </Typography>
                <Typography gutterBottom variant="body1">
                  These Terms, and any dispute arising out of them or
                  out of your use of GRCpay or the public instance,
                  are governed by the laws of {GOVERNING_LAW}, without
                  regard to conflict-of-laws principles. The courts of
                  {' '}
                  {GOVERNING_LAW}
                  {' '}
                  have exclusive jurisdiction.
                </Typography>
                <Typography gutterBottom variant="body1">
                  If you are a consumer habitually resident in the
                  European Union, the United Kingdom, or another
                  jurisdiction whose consumer-protection law cannot
                  lawfully be displaced by contract, you also retain
                  the protections of the mandatory law of your
                  residence and may bring claims in the courts of your
                  residence to the extent that law requires.
                </Typography>
              </Box>

              <Box id="changes" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  Changes
                </Typography>
                <Typography gutterBottom variant="body1">
                  These Terms may be updated from time to time. The
                  current version is always the one served at this URL,
                  with the effective date below. Your continued use of
                  GRCpay or the public instance after a change
                  constitutes acceptance of the updated Terms.
                </Typography>
              </Box>

              <Box id="contact" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  Contact
                </Typography>
                <Typography gutterBottom variant="body1">
                  General queries, abuse reports, IP-infringement
                  notices, lawful-process correspondence, and DSA
                  Article 11 / 12 / 16 contact for the public
                  instance:
                  {' '}
                  <NextMuiLink
                    href={`mailto:${CONTACT_EMAIL}`}
                    color="primary"
                  >
                    {CONTACT_EMAIL}
                  </NextMuiLink>
                  . The operator accepts service of process and
                  authority correspondence in English at this address.
                </Typography>
              </Box>

              <Divider sx={{ my: 4 }} />
              <Typography variant="caption" color="text.secondary" component="p">
                Effective date: {EFFECTIVE_DATE}
              </Typography>
            </Grid>
          </Grid>
        </Container>
        <Footer />
      </PageWrapper>
      <ScrollTopFab />
    </>
  );
}
