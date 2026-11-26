import express from 'express';
import { MarketNetworkService } from '../services/marketNetworkService.ts';

export function createMarketNetworkRouter(service: MarketNetworkService): express.Router {
  const router = express.Router();

  // 1. Combined Overview (Assets, Macro, Provider Status, Correlations, BTC Cross Analysis)
  router.get('/overview', async (_req, res) => {
    try {
      const data = await service.getOverview();
      res.json(data);
    } catch (err) {
      res.status(500).json({
        error: 'MARKET_NETWORK_OVERVIEW_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // 2. Asset latest prices & 1h/4h/24h changes
  router.get('/assets', async (_req, res) => {
    try {
      const assets = await service.getAssets();
      res.json({ assets, timestampIso: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({
        error: 'MARKET_NETWORK_ASSETS_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // 3. Asset 5m OHLCV series
  router.get('/assets/:id/ohlcv', async (req, res) => {
    try {
      const limitRaw = req.query.limit !== undefined ? Number(req.query.limit) : 288;
      if (!Number.isFinite(limitRaw) || limitRaw <= 0) {
        res.status(400).json({ error: 'INVALID_LIMIT', message: '유효하지 않은 limit 파라미터입니다.' });
        return;
      }
      const data = await service.getAssetOhlcv(req.params.id, limitRaw);
      res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes('지원하지 않는 자산') ? 404 : 500;
      res.status(status).json({ error: 'MARKET_NETWORK_OHLCV_ERROR', message: msg });
    }
  });

  // 4. Asset return Pearson correlation matrices (24h & 30d)
  router.get('/correlations/assets', async (_req, res) => {
    try {
      const correlations = await service.getAssetCorrelations();
      res.json(correlations);
    } catch (err) {
      res.status(500).json({
        error: 'MARKET_NETWORK_ASSET_CORR_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // 5. Macro indicators (DXY, M2SL, DGS10)
  router.get('/macro', async (_req, res) => {
    try {
      const macro = await service.getMacro();
      res.json({ macro, timestampIso: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({
        error: 'MARKET_NETWORK_MACRO_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // 6. Macro correlation analysis
  router.get('/correlations/macro', async (_req, res) => {
    try {
      const summary = await service.getMacroCorrelations();
      res.json(summary);
    } catch (err) {
      res.status(500).json({
        error: 'MARKET_NETWORK_MACRO_CORR_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // 7. BTC <-> DXY and BTC <-> M2 YoY cross analysis
  router.get('/cross-analysis', async (_req, res) => {
    try {
      const cross = await service.getBtcMacroCrossAnalysis();
      res.json(cross);
    } catch (err) {
      res.status(500).json({
        error: 'MARKET_NETWORK_CROSS_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // 8. Collection status & provider health
  router.get('/status', async (_req, res) => {
    try {
      const status = await service.getStatusSnapshot(false);
      res.json(status);
    } catch (err) {
      res.status(500).json({
        error: 'MARKET_NETWORK_STATUS_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Manual incremental sync trigger
  router.post('/sync', async (_req, res) => {
    try {
      await service.ensureSynced(true);
      const overview = await service.getOverview();
      res.json(overview);
    } catch (err) {
      res.status(500).json({
        error: 'MARKET_NETWORK_SYNC_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
