package lol.kotobaflow.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class HighRefreshRatePolicyTest {

    private static HighRefreshRatePolicy.ModeCandidate mode(
        int id,
        int width,
        int height,
        float rate
    ) {
        return new HighRefreshRatePolicy.ModeCandidate(id, width, height, rate);
    }

    @Test
    public void selectsExactHighestSameResolutionMode() {
        HighRefreshRatePolicy.ModeCandidate selected = HighRefreshRatePolicy.choosePreferredMode(
            new HighRefreshRatePolicy.ModeCandidate[] {
                mode(1, 1080, 2400, 60f),
                mode(2, 1440, 3200, 160f),
                mode(3, 1080, 2400, 120f),
                mode(4, 1080, 2400, 144f),
                mode(5, 1080, 2400, 159.9f),
            },
            1080,
            2400
        );

        assertNotNull(selected);
        assertEquals(5, selected.modeId);
        assertEquals(159.9f, selected.refreshRate, 0.01f);
    }

    @Test
    public void neverChangesResolutionToReachAHighRate() {
        HighRefreshRatePolicy.ModeCandidate selected = HighRefreshRatePolicy.choosePreferredMode(
            new HighRefreshRatePolicy.ModeCandidate[] {
                mode(1, 1080, 2400, 90f),
                mode(2, 1440, 3200, 160f),
            },
            1080,
            2400
        );

        assertNotNull(selected);
        assertEquals(1, selected.modeId);
    }

    @Test
    public void leavesHigherOnlyPanelToSystemInsteadOfForcing60Hz() {
        assertNull(
            HighRefreshRatePolicy.choosePreferredMode(
                new HighRefreshRatePolicy.ModeCandidate[] {
                    mode(1, 1080, 2400, 60f),
                    mode(2, 1080, 2400, 165f),
                },
                1080,
                2400
            )
        );
    }

    @Test
    public void prefersTheHighestSupportedRateUpTo160Hz() {
        assertEquals(
            160f,
            HighRefreshRatePolicy.choosePreferredRate(new float[] {60f, 90f, 120f, 144f, 160f}),
            0.01f
        );
    }

    @Test
    public void supports144And120HzWhenTheyAreTheHighestAvailableModes() {
        assertEquals(
            144f,
            HighRefreshRatePolicy.choosePreferredRate(new float[] {60f, 90f, 144f}),
            0.01f
        );
        assertEquals(
            120f,
            HighRefreshRatePolicy.choosePreferredRate(new float[] {60f, 120f, 165f}),
            0.01f
        );
    }

    @Test
    public void retainsLowerRateCompatibilityAndDoesNotForceHigherOnlyDisplaysDown() {
        assertEquals(
            90f,
            HighRefreshRatePolicy.choosePreferredRate(new float[] {60f, 90f}),
            0.01f
        );
        assertEquals(
            0f,
            HighRefreshRatePolicy.choosePreferredRate(new float[] {60f, 165f}),
            0.01f
        );
    }

    @Test
    public void ignoresInvalidAndVeryLowRates() {
        assertEquals(
            0f,
            HighRefreshRatePolicy.choosePreferredRate(new float[] {0f, 30f, Float.NaN, Float.POSITIVE_INFINITY}),
            0.01f
        );
    }
}
