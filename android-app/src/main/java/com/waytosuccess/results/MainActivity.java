package com.waytosuccess.results;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private static final String PORTAL_URL = "https://wts-result-system.vercel.app/";
    private static final int FILE_PICKER_REQUEST = 1001;
    // Only these hosts may load inside the app. Anything else leaves the WebView,
    // so an outside page can never reach the print bridge or the session cookies.
    private static final String[] ALLOWED_HOSTS = {
        "wts-result-system.vercel.app",
        "wts-school-platform.vercel.app",
        "wts-central-registry.vercel.app",
        "portal.waytosuccessschools.com"
    };

    private static boolean isTrusted(String url) {
        if (url == null) return false;
        try {
            String host = Uri.parse(url).getHost();
            if (host == null) return false;
            host = host.toLowerCase();
            for (String allowed : ALLOWED_HOSTS) {
                if (host.equals(allowed) || host.endsWith("." + allowed)) return true;
            }
        } catch (Exception ignored) { }
        return false;
    }

    private WebView webView;
    private ValueCallback<Uri[]> fileUploadCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setTextZoom(100);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.addJavascriptInterface(new PrintBridge(), "AndroidPrint");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    if (isTrusted(uri.toString())) return false;   // stay in the app
                    openExternally(uri);                            // everything else leaves
                    return true;
                }
                openExternally(uri);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                view.evaluateJavascript(
                    "(function(){if(!window.__wtsAndroidPrint){window.__wtsAndroidPrint=true;window.print=function(){AndroidPrint.printPage();};}})();",
                    null
                );
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileUploadCallback != null) {
                    fileUploadCallback.onReceiveValue(null);
                }
                fileUploadCallback = callback;
                Intent intent = params.createIntent();
                try {
                    startActivityForResult(intent, FILE_PICKER_REQUEST);
                } catch (Exception ex) {
                    fileUploadCallback = null;
                    return false;
                }
                return true;
            }
        });

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.setMimeType(mimeType);
                request.addRequestHeader("User-Agent", userAgent);
                request.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url));
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                String suffix = ".bin";
                if (mimeType != null && mimeType.contains("pdf")) suffix = ".pdf";
                else if (mimeType != null && mimeType.contains("csv")) suffix = ".csv";
                else if (mimeType != null && mimeType.contains("png")) suffix = ".png";
                else if (mimeType != null && mimeType.contains("jpeg") || mimeType != null && mimeType.contains("jpg")) suffix = ".jpg";
                String fileName = "wts-result-" + new java.text.SimpleDateFormat("yyyyMMdd-HHmmss", java.util.Locale.US).format(new java.util.Date()) + suffix;
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
                DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                manager.enqueue(request);
            }
        });

        if (savedInstanceState == null) {
            webView.loadUrl(PORTAL_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onStop() {
        super.onStop();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_PICKER_REQUEST && fileUploadCallback != null) {
            Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileUploadCallback.onReceiveValue(result);
            fileUploadCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    private void printCurrentPage() {
        printCurrentPage(false);
    }

    private void printCurrentPage(boolean isLandscape) {
        if (webView == null) return;
        PrintManager printManager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
        String jobName = getString(R.string.app_name) + " Print";
        PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(jobName);
        PrintAttributes.Builder builder = new PrintAttributes.Builder()
            .setColorMode(PrintAttributes.COLOR_MODE_COLOR);
        if (isLandscape) {
            builder.setMediaSize(PrintAttributes.MediaSize.ISO_A4.asLandscape());
        } else {
            builder.setMediaSize(PrintAttributes.MediaSize.ISO_A4.asPortrait());
        }
        printManager.print(jobName, adapter, builder.build());
    }

    private void openExternally(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
            // no handler installed; the current page stays usable
        }
    }

    private boolean bridgeAllowed() {
        return webView != null && isTrusted(webView.getUrl());
    }

    private class PrintBridge {
        @JavascriptInterface
        public void printPage() {
            if (!bridgeAllowed()) return;
            printPage("portrait");
        }

        @JavascriptInterface
        public void printPage(final String orientation) {
            if (!bridgeAllowed()) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    boolean isLandscape = "landscape".equalsIgnoreCase(orientation);
                    printCurrentPage(isLandscape);
                }
            });
        }

        @JavascriptInterface
        public void printPortrait() {
            if (!bridgeAllowed()) return;
            printPage("portrait");
        }

        @JavascriptInterface
        public void printLandscape() {
            if (!bridgeAllowed()) return;
            printPage("landscape");
        }
    }
}
