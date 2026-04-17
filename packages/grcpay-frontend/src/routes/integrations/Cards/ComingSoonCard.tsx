import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Chip,
  Typography,
} from '@mui/material';

interface Props {
  name: string;
  description: string;
}

export function ComingSoonCard({ name, description }: Props) {
  return (
    <Card variant="outlined" sx={{ height: '100%', opacity: 0.85 }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="h6" component="h3">
            {name}
          </Typography>
          <Chip
            label="Coming soon"
            size="small"
            sx={{ fontWeight: 700 }}
          />
        </Box>
        <Typography variant="body2" sx={{ color: 'text.secondary', pt: 1 }}>
          {description}
        </Typography>
      </CardContent>
    </Card>
  );
}
