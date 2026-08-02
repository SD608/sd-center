package com.sd608.center;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.SafeBrowsingResponse;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final String HOME_URL = "https://sd608.github.io/sd-center/mobile.html";
    private static final String TRUSTED_HOST = "sd608.github.io";
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        configureWebView();
        setContentView(webView);
        applyFullscreenSafely();

        if (savedInstanceState == null) {
            if (isOnline()) {
                webView.loadUrl(HOME_URL);
            } else {
                showOfflinePage();
            }
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(7, 17, 31));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " SD608Android/1.0.3");
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new SDCenterClient());
        webView.setDownloadListener(new SDCenterDownloadListener());
    }

    /**
     * 기기별 WindowInsets 호환 문제를 피하기 위해 Android 전 버전에서
     * 검증된 시스템 UI 플래그만 사용한다. 오류가 나더라도 앱 실행은 계속된다.
     */
    private void applyFullscreenSafely() {
        try {
            View decorView = getWindow().getDecorView();
            decorView.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        } catch (Throwable ignored) {
            // 전체화면 적용 실패가 앱 종료로 이어지지 않게 한다.
        }
    }

    private final class SDCenterClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if ("https".equalsIgnoreCase(uri.getScheme()) && TRUSTED_HOST.equalsIgnoreCase(uri.getHost())) {
                return false;
            }
            openExternal(uri);
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                showOfflinePage();
            }
        }

        @Override
        public void onSafeBrowsingHit(WebView view, WebResourceRequest request, int threatType, SafeBrowsingResponse callback) {
            callback.backToSafety(true);
            Toast.makeText(MainActivity.this, "안전하지 않은 주소를 차단했습니다.", Toast.LENGTH_LONG).show();
        }
    }

    private final class SDCenterDownloadListener implements DownloadListener {
        @Override
        public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.setMimeType(mimetype);
                request.addRequestHeader("User-Agent", userAgent);
                request.setTitle("SD종합센터 다운로드");
                request.setDescription("파일을 다운로드하고 있습니다.");
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "SDCenter-Mobile.apk");
                DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                manager.enqueue(request);
                Toast.makeText(MainActivity.this, "다운로드를 시작했습니다.", Toast.LENGTH_SHORT).show();
            } catch (Exception error) {
                openExternal(Uri.parse(url));
            }
        }
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "이 주소를 열 수 있는 앱이 없습니다.", Toast.LENGTH_LONG).show();
        }
    }

    private boolean isOnline() {
        try {
            ConnectivityManager manager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (manager == null) return false;
            NetworkCapabilities capabilities = manager.getNetworkCapabilities(manager.getActiveNetwork());
            return capabilities != null &&
                (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                 capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
                 capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET));
        } catch (Throwable ignored) {
            // 네트워크 판별 API가 기기에서 실패하면 WebView가 직접 접속을 시도하게 한다.
            return true;
        }
    }

    private void showOfflinePage() {
        String html = "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'>" +
            "<body style='margin:0;background:#07111f;color:#edf6ff;font-family:sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center'>" +
            "<main style='padding:28px'><h1>인터넷 연결 없음</h1><p style='color:#9fb1c8;line-height:1.7'>SD종합센터 Mobile은 홈페이지 온라인 계정에 연결되어야 합니다.<br>인터넷을 연결한 뒤 아래 버튼을 누르세요.</p>" +
            "<button onclick=\"location.href='" + HOME_URL + "'\" style='border:0;border-radius:12px;padding:13px 18px;background:#258fd7;color:white;font-weight:800'>다시 연결</button></main></body>";
        webView.loadDataWithBaseURL(HOME_URL, html, "text/html", "UTF-8", null);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyFullscreenSafely();
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyFullscreenSafely();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
