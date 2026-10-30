package lol.kotobaflow.app;

/**
 * Chooses a safe refresh-rate preference for the Android window.
 *
 * <p>The window preference is deliberately bounded at 160 Hz. A device with
 * only higher modes is left to the system rather than being forced down to a
 * lower rate, while devices with 120/144/160 Hz modes use the highest mode
 * available at the current display resolution.</p>
 */
final class HighRefreshRatePolicy {

    static final float MAX_PREFERRED_RATE_HZ = 160f;
    private static final float MIN_USABLE_RATE_HZ = 59f;
    private static final float MIN_HIGH_RATE_HZ = 119f;
    private static final float RATE_TOLERANCE_HZ = 0.5f;

    private HighRefreshRatePolicy() {}

    static final class ModeCandidate {

        final int modeId;
        final int width;
        final int height;
        final float refreshRate;

        ModeCandidate(int modeId, int width, int height, float refreshRate) {
            this.modeId = modeId;
            this.width = width;
            this.height = height;
            this.refreshRate = refreshRate;
        }
    }

    /**
     * Selects an exact display mode without ever changing the panel resolution.
     *
     * <p>An exact mode id is required on devices whose vendor policy ignores a
     * window refresh-rate hint. Returning {@code null} means no preference.</p>
     */
    static ModeCandidate choosePreferredMode(
        ModeCandidate[] supportedModes,
        int currentWidth,
        int currentHeight
    ) {
        ModeCandidate selected = null;
        boolean hasRateAboveCeiling = false;
        if (supportedModes == null || currentWidth <= 0 || currentHeight <= 0) return null;

        for (ModeCandidate mode : supportedModes) {
            if (mode == null || mode.modeId <= 0) continue;
            if (mode.width != currentWidth || mode.height != currentHeight) continue;
            float rate = mode.refreshRate;
            if (Float.isNaN(rate) || Float.isInfinite(rate)) continue;
            if (rate > MAX_PREFERRED_RATE_HZ + RATE_TOLERANCE_HZ) {
                hasRateAboveCeiling = true;
                continue;
            }
            if (rate < MIN_USABLE_RATE_HZ) continue;
            if (selected == null || rate > selected.refreshRate) selected = mode;
        }

        if (
            hasRateAboveCeiling &&
            (selected == null || selected.refreshRate < MIN_HIGH_RATE_HZ)
        ) return null;
        return selected;
    }

    /**
     * Returns the highest usable supported rate at or below 160 Hz.
     *
     * <p>Returning {@code 0} means "no preference", which lets Android keep
     * its automatic choice when no suitable mode is available (for example,
     * when a display exposes only a mode above the app's 160 Hz ceiling).</p>
     */
    static float choosePreferredRate(float[] supportedRates) {
        float selectedRate = 0f;
        boolean hasRateAboveCeiling = false;
        if (supportedRates == null) return selectedRate;

        for (float rate : supportedRates) {
            if (Float.isNaN(rate) || Float.isInfinite(rate)) continue;
            if (rate > MAX_PREFERRED_RATE_HZ + RATE_TOLERANCE_HZ) {
                hasRateAboveCeiling = true;
                continue;
            }
            if (rate < MIN_USABLE_RATE_HZ) {
                continue;
            }
            if (rate > selectedRate) selectedRate = rate;
        }
        if (hasRateAboveCeiling && selectedRate < MIN_HIGH_RATE_HZ) return 0f;
        return selectedRate;
    }
}
