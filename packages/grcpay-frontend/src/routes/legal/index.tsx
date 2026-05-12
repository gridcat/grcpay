import React from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Container,
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

export function Page() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <>
      <Seo
        title={`${SITE_NAME} :: Legal overview`}
        description="An orientation pass for self-hosters: what running GRCpay against your own wallet may trigger under EU, US, and other laws. Not legal advice."
        path="/legal"
        ogType="article"
        jsonLd={{
          '@context': 'https://schema.org',
          '@graph': [
            breadcrumbList([
              { name: 'Home', path: '/' },
              { name: 'Legal overview', path: '/legal' },
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
                  Legal overview for self-hosters
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  An orientation pass, not advice, for anyone running
                  GRCpay against their own Gridcoin wallet to accept
                  payments commercially. Read it before you flip your
                  checkout from sandbox to live, and talk to a lawyer
                  in your jurisdiction before you do anything important.
                </Typography>
              </Box>

              <Alert severity="info" variant="outlined" sx={{ mb: 4 }}>
                <AlertTitle>This page is not legal advice</AlertTitle>
                It&apos;s a map. The terrain it describes (crypto
                payment regulation) is moving, jurisdiction-specific,
                and unforgiving when you get it wrong. The page tells
                you which regimes might engage with what you&apos;re
                doing; a lawyer in your jurisdiction tells you what to
                do about it.
              </Alert>

              <Box id="overview" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  Overview
                </Typography>
                <Typography gutterBottom variant="body1">
                  GRCpay is a small piece of open-source software. The
                  authors publish it; you the merchant run it. The
                  moment you start running it commercially, you become
                  the operator of crypto-payment infrastructure under
                  the laws applicable to you. That is a meaningful
                  step.
                </Typography>
                <Typography gutterBottom variant="body1">
                  This page is a heads-up about the regimes that
                  typically engage when small operators in the EU, US,
                  UK, Switzerland, Singapore, and the UAE start
                  accepting crypto payments. None of it is exhaustive,
                  some of it will be wrong by the time you read it,
                  and all of it depends on your specific facts. Treat
                  it as a checklist of things to ask your lawyer about,
                  not as a substitute for asking.
                </Typography>
              </Box>

              <Box id="line" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  Where the line sits
                </Typography>
                <Typography gutterBottom variant="body1">
                  The single most important legal distinction in this
                  whole space is the line between
                  {' '}
                  <strong>publishing software</strong>
                  {' '}
                  and
                  {' '}
                  <strong>operating a service</strong>
                  . Almost every regulator&apos;s test, in practice,
                  collapses to one question: are you holding customer
                  funds, forwarding them to someone, or otherwise
                  standing between two parties to a payment?
                </Typography>
                <Typography gutterBottom variant="body1">
                  The GRCpay
                  {' '}
                  <strong>maintainers</strong>
                  {' '}
                  publish source code. They do not provide a service
                  to your customers and have no relationship with
                  them. The
                  {' '}
                  <strong>operator of a self-hosted GRCpay
                  instance</strong>
                  {' '}
                  (you) is on the other side of that line, because
                  your wallet daemon receives customer funds and your
                  software forwards them. Most of what follows is
                  about your side of the line, not theirs.
                </Typography>
                <Typography gutterBottom variant="body1">
                  Two things shrink your exposure regardless of
                  jurisdiction:
                </Typography>
                <Box component="ul" sx={{ pl: 3, mt: 0 }}>
                  <Typography component="li" variant="body1" gutterBottom>
                    <strong>Receive only for your own business.</strong>
                    {' '}
                    If the wallet receives payments only for goods or
                    services
                    {' '}
                    <em>you</em>
                    {' '}
                    sell, and forwards nothing onward to other
                    merchants, you are accepting payment in crypto for
                    your own business. That is widely treated as
                    ordinary merchant activity, not as a payment
                    service. The moment you start receiving on behalf
                    of someone else and routing funds to them, the
                    legal class changes sharply.
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    <strong>Hold briefly, sweep often.</strong>
                    {' '}
                    The longer you hold customer funds, and the more
                    of them, the more your activity looks like
                    custody. Sweeping into cold storage on a fixed
                    cadence and disclosing the wallet structure to
                    your accountant is the boring, defensible pattern.
                  </Typography>
                </Box>
              </Box>

              <Box id="eu" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  EU regulatory map
                </Typography>
                <Typography gutterBottom variant="body1">
                  If you serve EU customers, or are established in the
                  EU, four regulations are worth being aware of.
                </Typography>

                <Typography variant="h6" component="h3" sx={{ pt: 2, pb: 1 }}>
                  MiCA (Regulation 2023/1114)
                </Typography>
                <Typography gutterBottom variant="body1">
                  Provides the EU&rsquo;s authorisation regime for
                  Crypto-Asset Service Providers (CASPs). Two of its
                  service categories are relevant:
                  {' '}
                  <em>custody and administration of crypto-assets on
                  behalf of clients</em>
                  {' '}
                  (Article 3(1)(17)) and
                  {' '}
                  <em>providing transfer services for crypto-assets on
                  behalf of clients</em>
                  {' '}
                  (Article 3(1)(26)). A merchant accepting payment for
                  their own goods is generally not providing those
                  services to anyone — they are simply a payee. A
                  merchant routing payments to other merchants is.
                </Typography>
                <Typography gutterBottom variant="body1">
                  The transitional period for legacy national
                  registrations expires 1 July 2026. After that, EU
                  CASP authorisation is the only credible route to
                  professional payment-service activity in the bloc.
                  Capital requirement for custody + transfer services
                  is €125,000.
                </Typography>

                <Typography variant="h6" component="h3" sx={{ pt: 2, pb: 1 }}>
                  Transfer of Funds Regulation (Regulation 2023/1113)
                </Typography>
                <Typography gutterBottom variant="body1">
                  In force since 30 December 2024. The EU&rsquo;s
                  &ldquo;Travel Rule&rdquo;: CASPs must collect and
                  transmit originator and beneficiary information for
                  every crypto-asset transfer, with no de-minimis
                  threshold between CASPs. Self-hosted-wallet
                  transfers above €1,000 require proof of customer
                  control. Whether this engages a self-hosting
                  merchant depends on whether they fall within the
                  CASP definition above.
                </Typography>

                <Typography variant="h6" component="h3" sx={{ pt: 2, pb: 1 }}>
                  AMLR (Anti-Money-Laundering Regulation)
                </Typography>
                <Typography gutterBottom variant="body1">
                  Phasing in through July 2027. Imposes KYC for
                  occasional transactions ≥€1,000, suspicious-activity
                  reporting, sanctions screening, beneficial-ownership
                  registration, and (from 2027) restrictions on
                  handling anonymity-enhanced cryptoassets. Engages
                  any &ldquo;obliged entity,&rdquo; which CASPs are.
                </Typography>

                <Typography variant="h6" component="h3" sx={{ pt: 2, pb: 1 }}>
                  DAC8 (Directive 2023/2226)
                </Typography>
                <Typography gutterBottom variant="body1">
                  In force from 1 January 2026. Crypto-asset service
                  providers report annual user transaction data to tax
                  authorities, exchanged across Member States.
                </Typography>

                <Typography variant="h6" component="h3" sx={{ pt: 2, pb: 1 }}>
                  VAT
                </Typography>
                <Typography gutterBottom variant="body1">
                  CJEU
                  {' '}
                  <em>Hedqvist</em>
                  {' '}
                  (C-264/14, 2015) treats the exchange of crypto for
                  fiat as a VAT-exempt currency exchange. Receipt of
                  GRC for goods or services is, however, a normal
                  taxable supply at VAT rates applicable to those
                  goods or services; the tax base is the GRC amount
                  converted to fiat at the time of supply. Talk to
                  your accountant about invoicing, the time of supply,
                  and the FX rate methodology.
                </Typography>
              </Box>

              <Box id="us" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  United States
                </Typography>
                <Typography gutterBottom variant="body1">
                  The federal regime is FinCEN under the Bank Secrecy
                  Act. Per the 2013 and 2019 FinCEN guidance, an
                  &ldquo;exchanger&rdquo; or &ldquo;administrator&rdquo;
                  of convertible virtual currency is a money
                  transmitter and must register as a Money Services
                  Business. A merchant accepting cryptocurrency for
                  their own goods is generally
                  {' '}
                  <em>not</em>
                  {' '}
                  a money transmitter; a service that holds and
                  forwards customer funds to other merchants
                  generally
                  {' '}
                  <em>is</em>
                  .
                </Typography>
                <Typography gutterBottom variant="body1">
                  States are the harder layer. ~50 separate Money
                  Transmitter Licenses, with varying scope, capital,
                  and surety-bond requirements. New York&rsquo;s
                  BitLicense is the most restrictive. Operating
                  unlicensed where licensure is required is a federal
                  crime under
                  {' '}
                  <strong>18 USC § 1960</strong>
                  {' '}
                  (5 years + $250,000 per principal), with strict
                  liability on the licensing element — not knowing the
                  rule is not a defence.
                </Typography>
                <Typography gutterBottom variant="body1">
                  OFAC sanctions apply with strict liability to any
                  transaction touching a sanctioned address, regardless
                  of intent. Merchants accepting GRC should screen
                  counterparty addresses they know about and avoid
                  comprehensively-sanctioned jurisdictions.
                </Typography>
              </Box>

              <Box id="uk-other" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  UK &amp; other major jurisdictions
                </Typography>
                <Typography gutterBottom variant="body1">
                  <strong>UK:</strong>
                  {' '}
                  the Financial Conduct Authority operates a
                  registered cryptoasset business regime under the
                  MLRs since January 2020. Service-shaped activity
                  (custody, exchange) needs registration; merchant
                  acceptance generally does not, but the line is
                  fact-specific. The Online Safety Act and consumer
                  duty layer on top.
                </Typography>
                <Typography gutterBottom variant="body1">
                  <strong>Switzerland:</strong>
                  {' '}
                  FINMA + a self-regulatory body (typically VQF)
                  governs crypto-payment activity. Distinguishes
                  custodial from non-custodial models cleanly and is
                  one of the friendliest regimes for small operators.
                </Typography>
                <Typography gutterBottom variant="body1">
                  <strong>Liechtenstein:</strong>
                  {' '}
                  TVTG (Blockchain Act 2020) is among the cleanest in
                  Europe and passports into the EEA. Worth knowing
                  about if you ever scale beyond hobbyist size.
                </Typography>
                <Typography gutterBottom variant="body1">
                  <strong>Singapore:</strong>
                  {' '}
                  Monetary Authority of Singapore Payment Services
                  Act, Digital Payment Token regime. Strict, well-run.
                </Typography>
                <Typography gutterBottom variant="body1">
                  <strong>UAE / Dubai:</strong>
                  {' '}
                  Virtual Assets Regulatory Authority (VARA). Licensed
                  but expensive.
                </Typography>
                <Typography gutterBottom variant="body1">
                  Other jurisdictions vary widely. Check before you
                  serve customers across a border.
                </Typography>
              </Box>

              <Box id="aml-kyc" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  AML, KYC, and sanctions
                </Typography>
                <Typography gutterBottom variant="body1">
                  GRCpay does not perform any anti-money-laundering
                  function. It accepts an order shape, mints an
                  address, watches for inbound funds, and forwards
                  them. Whether KYC, sanctions screening, or
                  suspicious-activity monitoring applies to your usage
                  depends entirely on what you&apos;re doing and where
                  you&apos;re doing it.
                </Typography>
                <Typography gutterBottom variant="body1">
                  Practical baseline for a small merchant:
                </Typography>
                <Box component="ul" sx={{ pl: 3, mt: 0 }}>
                  <Typography component="li" variant="body1" gutterBottom>
                    Don&apos;t knowingly transact with sanctioned
                    counterparties or comprehensively-sanctioned
                    jurisdictions. If a customer&apos;s wallet
                    appears on a public sanctions list, refund and
                    decline.
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    For larger or recurring transactions, consider
                    name-based KYC at the order layer rather than the
                    payment layer: your storefront collects enough
                    customer information to satisfy the AML rules
                    that apply to you, independent of what GRCpay
                    does.
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    Keep records: order id, customer info you
                    collected, GRCpay wallet address, recipient
                    address, transaction id, fiat-equivalent at time
                    of payment. Useful for tax, dispute resolution,
                    and any later regulatory question.
                  </Typography>
                </Box>
              </Box>

              <Box id="travel-rule" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  The Travel Rule
                </Typography>
                <Typography gutterBottom variant="body1">
                  FATF Recommendation 16 (the &ldquo;Travel
                  Rule&rdquo;) requires regulated crypto service
                  providers to collect and transmit originator and
                  beneficiary information for transfers above local
                  thresholds. The EU has implemented this through the
                  TFR (no de-minimis between CASPs); the US through
                  FinCEN&rsquo;s Travel Rule ($3,000 threshold, with
                  proposed lowering to $250 for cross-border CVC
                  transfers); the UK through the MLRs.
                </Typography>
                <Typography gutterBottom variant="body1">
                  The Travel Rule engages
                  {' '}
                  <em>regulated CASPs / VASPs / MSBs</em>
                  , not ordinary merchants. If you&apos;re a merchant
                  receiving payment for your own goods, the rule
                  generally does not apply to you on the receiving
                  side. If your activity drifts into providing payment
                  services to others, it does. Sustained ambiguity is
                  the case to ask a lawyer about.
                </Typography>
              </Box>

              <Box id="tax" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  Tax orientation
                </Typography>
                <Typography gutterBottom variant="body1">
                  Three tax events typically arise from accepting GRC
                  for goods or services:
                </Typography>
                <Box component="ol" sx={{ pl: 3, mt: 0 }}>
                  <Typography component="li" variant="body1" gutterBottom>
                    <strong>The supply itself.</strong>
                    {' '}
                    Receipt of GRC for goods or services is a normal
                    taxable supply at the VAT/GST rate applicable to
                    what you sold. The tax base is the GRC amount
                    converted to your reporting currency at the time
                    of supply.
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    <strong>Income / corporate tax.</strong>
                    {' '}
                    The fiat-equivalent of the GRC received at the
                    time of supply is income for income-tax /
                    corporate-tax purposes. Your books should record
                    the GRC amount and the conversion rate used.
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    <strong>Capital gain / loss on disposal.</strong>
                    {' '}
                    If you later convert that GRC to fiat or use it
                    to pay an expense, you realise a gain or loss
                    against the cost basis from step 2. In some
                    jurisdictions this is treated as ordinary
                    business income; in others as a capital gain.
                  </Typography>
                </Box>
                <Typography gutterBottom variant="body1">
                  None of this is automatic in GRCpay. Pull
                  transaction data into your accounting system, settle
                  on a consistent FX-rate methodology with your
                  accountant, and keep the receipts.
                </Typography>
              </Box>

              <Box id="lawyer" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  When to talk to a lawyer
                </Typography>
                <Typography gutterBottom variant="body1">
                  Worth a one-hour scoping call (typically €300–€600,
                  often free at startup clinics or via NGO programmes)
                  if any of the following are true:
                </Typography>
                <Box component="ul" sx={{ pl: 3, mt: 0 }}>
                  <Typography component="li" variant="body1" gutterBottom>
                    you intend to receive payments on behalf of other
                    merchants, not just yourself;
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    your monthly inbound volume reaches the level
                    where a tax authority might notice (varies, but
                    once you&apos;re doing four or five figures a
                    month routinely, the answer is yes);
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    you serve customers across borders, especially
                    EU↔non-EU or any direction crossing the US;
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    you accept GRC for anything in a regulated
                    sector (financial services, gambling, adult, age-
                    or licence-gated goods, healthcare);
                  </Typography>
                  <Typography component="li" variant="body1" gutterBottom>
                    you receive a notice from any tax authority,
                    central bank, financial regulator, or law
                    enforcement that mentions cryptoassets.
                  </Typography>
                </Box>
                <Typography gutterBottom variant="body1">
                  Choose a lawyer or law firm with crypto-payment
                  practice in your country, not a generalist. Bring
                  the
                  {' '}
                  <NextMuiLink href="/disclaimer" color="primary">Terms of Service</NextMuiLink>
                  {' '}
                  and a description of your actual flow; an hour with
                  the right lawyer answers more than a week of
                  reading.
                </Typography>
              </Box>

              <Box id="not-advice" sx={{ pb: 4 }}>
                <Typography variant="h5" component="h2" sx={{ pb: 2 }}>
                  This is not legal advice
                </Typography>
                <Typography gutterBottom variant="body1">
                  This page is an orientation pass authored by
                  software developers, not lawyers. It is offered as
                  a starting point for your own research and as a
                  list of things to ask your own counsel about. It is
                  not, and is not intended to be, legal advice. The
                  GRCpay maintainers, the gridcoin.club family
                  contributors, and the operators of the public
                  instance accept no responsibility for any decision
                  you make based on this page or for any liability
                  arising from your use of GRCpay.
                </Typography>
              </Box>
            </Grid>
          </Grid>
        </Container>
        <Footer />
      </PageWrapper>
      <ScrollTopFab />
    </>
  );
}
