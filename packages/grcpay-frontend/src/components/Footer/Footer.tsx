import {
  Container,
  Divider,
  Typography,
  Grid,
} from '@mui/material';
import GithubIcon from '@mui/icons-material/GitHub';
import Link from 'next/link';
import React from 'react';
import { styled } from '@mui/material/styles';
import { linkRel } from '@/lib/externalRel';
import { IS_TESTNET, SISTER_NETWORK_LABEL, SISTER_NETWORK_URL } from '@/lib/network';

const GITHUB_REPO_URL = 'https://github.com/gridcoin-community/grcpay.gridcoin.club';

const SubFooterTypography = styled(Typography)(({ theme }) => ({
  textAlign: 'left',
  lineHeight: theme.spacing(8),
  width: '100%',
  display: 'inline-block',
  color: theme.palette.text.disabled,
  [theme.breakpoints.down('sm')]: {
    textAlign: 'center',
    lineHeight: theme.spacing(5),
  },
}));

const FooterTextTypography = styled(Typography)(({ theme }) => ({
  display: 'inline-block',
  width: '100%',
  [theme.breakpoints.down('md')]: {
    textAlign: 'left',
  },
  [theme.breakpoints.down('sm')]: {
    textAlign: 'center',
  },
}));

export function Footer() {
  return (
    <Container maxWidth="xl">
      <div>
        <Divider />
      </div>
      <Grid container spacing={0} sx={{ mt: 2, mb: 2 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <FooterTextTypography variant="caption">
            Self-hosted Gridcoin payment facilitator. Privacy-first by design.
          </FooterTextTypography>
          <FooterTextTypography variant="caption" sx={{ color: 'text.disabled' }}>
            <Link href="/disclaimer" style={{ color: 'inherit' }}>Terms</Link>
            {' · '}
            <Link href="/legal" style={{ color: 'inherit' }}>Legal overview</Link>
          </FooterTextTypography>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <FooterTextTypography variant="caption" sx={{ textAlign: 'right' }}>
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel={linkRel(GITHUB_REPO_URL, '_blank')}
              style={{ display: 'inline-block' }}
            >
              <GithubIcon color="primary" sx={{ fontSize: 40 }} />
            </a>
          </FooterTextTypography>
        </Grid>
      </Grid>
      <Divider />
      <SubFooterTypography variant="caption">
        Made with
        {' '}
        <span style={{ color: 'red' }}>❤</span>
        {' '}
        by @gridcat
        {' · '}
        <a
          href="https://gridcoin.club"
          style={{ color: 'inherit' }}
        >
          Part of Gridcoin Club ↗
        </a>
        {SISTER_NETWORK_URL && (
          <>
            {' · '}
            <a
              href={SISTER_NETWORK_URL}
              style={{ color: 'inherit' }}
              rel={IS_TESTNET ? undefined : 'nofollow'}
            >
              {SISTER_NETWORK_LABEL}
              {' ↗'}
            </a>
          </>
        )}
      </SubFooterTypography>
    </Container>
  );
}
