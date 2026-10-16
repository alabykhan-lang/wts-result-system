package com.google.android.gms.mlkit.codescanner;

import com.google.android.gms.tasks.Task;
import com.google.mlkit.vision.barcode.common.Barcode;

/**
 * Compatibility wrapper for the Google Code Scanner namespace used by the
 * first WTS attendance scanner prototype.
 */
public final class GmsBarcodeScanner {
    private final com.google.mlkit.vision.codescanner.GmsBarcodeScanner delegate;

    GmsBarcodeScanner(com.google.mlkit.vision.codescanner.GmsBarcodeScanner delegate) {
        this.delegate = delegate;
    }

    public Task<Barcode> startScan() {
        return delegate.startScan();
    }
}
