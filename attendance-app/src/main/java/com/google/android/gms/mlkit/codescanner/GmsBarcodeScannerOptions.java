package com.google.android.gms.mlkit.codescanner;

/** Compatibility wrapper around ML Kit's Google Code Scanner options. */
public final class GmsBarcodeScannerOptions {
    final com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions delegate;

    private GmsBarcodeScannerOptions(
        com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions delegate
    ) {
        this.delegate = delegate;
    }

    public static final class Builder {
        private final com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions.Builder delegate =
            new com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions.Builder();

        public Builder setBarcodeFormats(int format) {
            delegate.setBarcodeFormats(format);
            return this;
        }

        public Builder enableAutoZoom() {
            delegate.enableAutoZoom();
            return this;
        }

        public GmsBarcodeScannerOptions build() {
            return new GmsBarcodeScannerOptions(delegate.build());
        }
    }
}
