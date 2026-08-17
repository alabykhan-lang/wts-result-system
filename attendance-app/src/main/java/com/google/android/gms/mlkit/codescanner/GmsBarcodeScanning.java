package com.google.android.gms.mlkit.codescanner;

import android.content.Context;

/** Compatibility entry point around ML Kit's Google Code Scanner client. */
public final class GmsBarcodeScanning {
    private GmsBarcodeScanning() {
    }

    public static GmsBarcodeScanner getClient(
        Context context,
        GmsBarcodeScannerOptions options
    ) {
        return new GmsBarcodeScanner(
            com.google.mlkit.vision.codescanner.GmsBarcodeScanning.getClient(
                context,
                options.delegate
            )
        );
    }
}
