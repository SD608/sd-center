package com.sd608.center;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.SafeBrowsingResponse;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String HOME_URL = "https://sd608.github.io/sd-center/mobile.html";
    private static final String TRUSTED_HOST = "sd608.github.io";
    private static final String[] UPDATE_INFO_URLS = new String[] {
        "https://raw.githubusercontent.com/SD608/sd-center/main/update/version.json",
        "https://sd608.github.io/sd-center/update/version.json"
    };
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final String PREFS = "sdcenter_update";
    private static final String PREF_PENDING_APK = "pending_apk_uri";
    private static final String PREF_DOWNLOAD_ID = "pending_download_id";

    private WebView webView;
    private final ExecutorService updateExecutor = Executors.newSingleThreadExecutor();
    private boolean updateCheckRunning = false;
    private boolean updateReceiverRegistered = false;
    private boolean waitingForInstallPermission = false;
    private boolean installerOpening = false;
    private long updateDownloadId = -1L;
    private final Handler updateHandler = new Handler(Looper.getMainLooper());

    private final BroadcastReceiver updateDownloadReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
            long completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
            long pendingId = pendingDownloadId();
            if (completedId == updateDownloadId || completedId == pendingId) {
                handleUpdateDownloadState(completedId, false);
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        registerUpdateReceiver();
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

        new Handler(Looper.getMainLooper()).postDelayed(() -> checkForUpdates(true), 2500L);
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
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
        settings.setUserAgentString(settings.getUserAgentString() + " SD608Android/1.0.6");
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new AndroidBridge(), "SDAndroid");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new SDCenterClient());
        webView.setDownloadListener(new SDCenterDownloadListener());
    }

    private final class AndroidBridge {
        @JavascriptInterface
        public void checkForUpdates() {
            runOnUiThread(() -> MainActivity.this.checkForUpdates(false));
        }

        @JavascriptInterface
        public String getAppVersion() {
            return currentVersionName();
        }

        @JavascriptInterface
        public void vibrate(int amplitude, int durationMs) {
            runOnUiThread(() -> vibrateOnce(amplitude, durationMs));
        }

        @JavascriptInterface
        public void vibrateExact() {
            runOnUiThread(MainActivity.this::vibrateExactPattern);
        }
    }

    private Vibrator getDefaultVibrator() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager manager = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                return manager == null ? null : manager.getDefaultVibrator();
            }
            return (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private void vibrateOnce(int amplitude, int durationMs) {
        try {
            Vibrator vibrator = getDefaultVibrator();
            if (vibrator == null || !vibrator.hasVibrator()) return;
            int safeAmplitude = Math.max(1, Math.min(255, amplitude));
            int safeDuration = Math.max(10, Math.min(500, durationMs));
            vibrator.vibrate(VibrationEffect.createOneShot(safeDuration, safeAmplitude));
        } catch (Throwable ignored) {
            // 진동 기능이 없는 기기에서도 게임은 계속 실행됩니다.
        }
    }

    private void vibrateExactPattern() {
        try {
            Vibrator vibrator = getDefaultVibrator();
            if (vibrator == null || !vibrator.hasVibrator()) return;
            long[] timings = new long[] {0L, 140L, 70L, 230L};
            int[] amplitudes = new int[] {0, 255, 0, 255};
            vibrator.vibrate(VibrationEffect.createWaveform(timings, amplitudes, -1));
        } catch (Throwable ignored) {
            // 강한 패턴이 지원되지 않으면 단발 진동으로 대체합니다.
            vibrateOnce(255, 220);
        }
    }

    private void registerUpdateReceiver() {
        try {
            // ACTION_DOWNLOAD_COMPLETE는 시스템 전용 브로드캐스트이므로 플래그 없이 등록한다.
            // 일부 삼성/최신 Android 기기에서 RECEIVER_NOT_EXPORTED 사용 시 완료 신호를
            // 받지 못해 APK만 내려받고 설치 화면이 열리지 않는 문제가 있었다.
            IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            registerReceiver(updateDownloadReceiver, filter);
            updateReceiverRegistered = true;
        } catch (Throwable error) {
            updateReceiverRegistered = false;
        }
    }

    private void checkForUpdates(boolean silent) {
        if (updateCheckRunning) {
            if (!silent) Toast.makeText(this, "업데이트를 확인하고 있습니다.", Toast.LENGTH_SHORT).show();
            return;
        }
        if (!isOnline()) {
            if (!silent) Toast.makeText(this, "인터넷 연결을 확인하세요.", Toast.LENGTH_LONG).show();
            return;
        }

        updateCheckRunning = true;
        if (!silent) Toast.makeText(this, "최신 버전을 확인합니다.", Toast.LENGTH_SHORT).show();

        updateExecutor.execute(() -> {
            try {
                UpdateInfo info = fetchUpdateInfo();
                runOnUiThread(() -> {
                    updateCheckRunning = false;
                    long currentCode = currentVersionCode();
                    if (info.versionCode > currentCode) {
                        showUpdateDialog(info);
                    } else if (!silent) {
                        Toast.makeText(this, "현재 최신 버전 " + currentVersionName() + "입니다.", Toast.LENGTH_LONG).show();
                    }
                });
            } catch (Exception error) {
                final String reason = error.getMessage() == null ? "연결 오류" : error.getMessage();
                runOnUiThread(() -> {
                    updateCheckRunning = false;
                    if (!silent) {
                        Toast.makeText(this, "업데이트 확인 실패: " + reason, Toast.LENGTH_LONG).show();
                    }
                });
            }
        });
    }

    private UpdateInfo fetchUpdateInfo() throws Exception {
        Exception lastError = null;
        for (String endpoint : UPDATE_INFO_URLS) {
            try {
                return fetchUpdateInfoFrom(endpoint);
            } catch (Exception error) {
                lastError = error;
            }
        }
        if (lastError != null) throw lastError;
        throw new IllegalStateException("업데이트 서버 주소가 없습니다.");
    }

    private UpdateInfo fetchUpdateInfoFrom(String endpoint) throws Exception {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(endpoint + "?t=" + System.currentTimeMillis());
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(15000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Cache-Control", "no-cache");
            connection.setRequestProperty("User-Agent", "SDCenter-Android/1.0.6");

            int responseCode = connection.getResponseCode();
            if (responseCode < 200 || responseCode >= 300) {
                throw new IllegalStateException("HTTP " + responseCode);
            }

            StringBuilder jsonText = new StringBuilder();
            try (InputStream stream = connection.getInputStream();
                 BufferedReader reader = new BufferedReader(
                     new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) jsonText.append(line);
            }

            JSONObject json = new JSONObject(jsonText.toString());
            int versionCode = json.optInt("versionCode", 0);
            String versionName = json.optString("versionName", "").trim();
            String downloadUrl = json.optString("downloadUrl", "").trim();
            String message = json.optString("message", "새 버전이 준비되었습니다.").trim();
            boolean required = json.optBoolean("required", false);

            if (versionCode <= 0 || versionName.isEmpty() || downloadUrl.isEmpty()) {
                throw new IllegalStateException("업데이트 정보 형식 오류");
            }
            URL apkUrl = new URL(downloadUrl);
            if (!"https".equalsIgnoreCase(apkUrl.getProtocol())) {
                throw new IllegalStateException("안전하지 않은 다운로드 주소");
            }
            return new UpdateInfo(versionCode, versionName, downloadUrl, message, required);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void showUpdateDialog(UpdateInfo info) {
        String message = "현재 " + currentVersionName() + " → 최신 " + info.versionName;
        if (!info.message.isEmpty()) message += "\n\n" + info.message;
        message += "\n\n업데이트를 누르면 APK 다운로드 후 Android 설치 화면이 열립니다.";

        AlertDialog.Builder builder = new AlertDialog.Builder(this)
            .setTitle("SD종합센터 업데이트")
            .setMessage(message)
            .setPositiveButton("업데이트", (dialog, which) -> startUpdateDownload(info));

        if (!info.required) builder.setNegativeButton("나중에", null);
        AlertDialog dialog = builder.create();
        dialog.setCancelable(!info.required);
        dialog.setOnDismissListener(ignored -> applyFullscreenSafely());
        dialog.show();
    }

    private void startUpdateDownload(UpdateInfo info) {
        try {
            DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            if (manager == null) throw new IllegalStateException("DownloadManager unavailable");

            String safeVersion = info.versionName.replaceAll("[^0-9A-Za-z._-]", "_");
            String fileName = "SDCenter-Mobile-" + safeVersion + ".apk";
            File directory = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (directory != null) {
                File oldFile = new File(directory, fileName);
                if (oldFile.exists()) oldFile.delete();
            }

            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(info.downloadUrl));
            request.setMimeType(APK_MIME);
            request.addRequestHeader("Accept", APK_MIME);
            request.setTitle("SD종합센터 " + info.versionName);
            request.setDescription("업데이트 APK를 다운로드하고 있습니다.");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(true);
            request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, fileName);

            updateDownloadId = manager.enqueue(request);
            getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit()
                .putLong(PREF_DOWNLOAD_ID, updateDownloadId)
                .remove(PREF_PENDING_APK)
                .apply();
            installerOpening = false;
            scheduleDownloadCheck(updateDownloadId, 1200L);
            Toast.makeText(this, "업데이트 다운로드를 시작했습니다.", Toast.LENGTH_LONG).show();
        } catch (Exception error) {
            Toast.makeText(this, "업데이트 다운로드를 시작하지 못했습니다.", Toast.LENGTH_LONG).show();
            openExternal(Uri.parse(info.downloadUrl));
        }
    }

    private void scheduleDownloadCheck(long downloadId, long delayMs) {
        if (downloadId <= 0L) return;
        updateHandler.postDelayed(() -> handleUpdateDownloadState(downloadId, true), delayMs);
    }

    private void handleUpdateDownloadState(long downloadId, boolean allowRetry) {
        if (downloadId <= 0L || installerOpening) return;
        DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        if (manager == null) return;

        int downloadStatus = DownloadManager.STATUS_FAILED;
        DownloadManager.Query query = new DownloadManager.Query().setFilterById(downloadId);
        try (android.database.Cursor cursor = manager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) {
                if (allowRetry) scheduleDownloadCheck(downloadId, 1500L);
                return;
            }
            int statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
            if (statusIndex >= 0) downloadStatus = cursor.getInt(statusIndex);
        } catch (Exception error) {
            if (allowRetry) scheduleDownloadCheck(downloadId, 1500L);
            return;
        }

        if (downloadStatus == DownloadManager.STATUS_PENDING ||
            downloadStatus == DownloadManager.STATUS_RUNNING ||
            downloadStatus == DownloadManager.STATUS_PAUSED) {
            if (allowRetry) scheduleDownloadCheck(downloadId, 1500L);
            return;
        }

        if (downloadStatus != DownloadManager.STATUS_SUCCESSFUL) {
            clearPendingDownload();
            Toast.makeText(this, "업데이트 다운로드에 실패했습니다.", Toast.LENGTH_LONG).show();
            return;
        }

        Uri apkUri = manager.getUriForDownloadedFile(downloadId);
        if (apkUri == null) {
            clearPendingDownload();
            Toast.makeText(this, "다운로드한 APK를 찾지 못했습니다.", Toast.LENGTH_LONG).show();
            return;
        }

        installerOpening = true;
        getSharedPreferences(PREFS, MODE_PRIVATE)
            .edit()
            .putString(PREF_PENDING_APK, apkUri.toString())
            .remove(PREF_DOWNLOAD_ID)
            .apply();
        updateDownloadId = -1L;
        requestInstall(apkUri);
    }

    private void requestInstall(Uri apkUri) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !getPackageManager().canRequestPackageInstalls()) {
            waitingForInstallPermission = true;
            installerOpening = false;
            Toast.makeText(this, "SD종합센터의 '이 출처 허용'을 켠 뒤 앱으로 돌아오세요.", Toast.LENGTH_LONG).show();
            try {
                Intent settingsIntent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getPackageName())
                );
                startActivity(settingsIntent);
            } catch (ActivityNotFoundException error) {
                openExternal(apkUri);
            }
            return;
        }
        launchInstaller(apkUri);
    }

    private void launchInstaller(Uri apkUri) {
        try {
            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, APK_MIME);
            installIntent.setClipData(ClipData.newRawUri("SD종합센터 업데이트", apkUri));
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(installIntent);
            getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit()
                .remove(PREF_PENDING_APK)
                .apply();
            installerOpening = false;
        } catch (ActivityNotFoundException | SecurityException error) {
            installerOpening = false;
            Toast.makeText(this, "APK 설치 화면을 열 수 없습니다. 다운로드 알림의 APK를 눌러 설치하세요.", Toast.LENGTH_LONG).show();
        }
    }

    private String pendingApkUri() {
        return getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_PENDING_APK, "");
    }

    private long pendingDownloadId() {
        return getSharedPreferences(PREFS, MODE_PRIVATE).getLong(PREF_DOWNLOAD_ID, -1L);
    }

    private void clearPendingDownload() {
        updateDownloadId = -1L;
        installerOpening = false;
        getSharedPreferences(PREFS, MODE_PRIVATE)
            .edit()
            .remove(PREF_DOWNLOAD_ID)
            .remove(PREF_PENDING_APK)
            .apply();
    }

    private long currentVersionCode() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return info.getLongVersionCode();
            return info.versionCode;
        } catch (Exception ignored) {
            return 0L;
        }
    }

    private String currentVersionName() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            return info.versionName == null ? "확인 불가" : info.versionName;
        } catch (Exception ignored) {
            return "확인 불가";
        }
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
            if (request.isForMainFrame()) showOfflinePage();
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
                if (manager == null) throw new IllegalStateException("DownloadManager unavailable");
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

        String pendingApk = pendingApkUri();
        if (!pendingApk.isEmpty() &&
            (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getPackageManager().canRequestPackageInstalls())) {
            waitingForInstallPermission = false;
            installerOpening = true;
            launchInstaller(Uri.parse(pendingApk));
            return;
        }

        if (waitingForInstallPermission && !pendingApk.isEmpty()) {
            waitingForInstallPermission = false;
            installerOpening = false;
            Toast.makeText(this, "업데이트 설치 권한이 필요합니다.", Toast.LENGTH_LONG).show();
        }

        long pendingId = pendingDownloadId();
        if (pendingId > 0L) {
            updateDownloadId = pendingId;
            scheduleDownloadCheck(pendingId, 300L);
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

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        if (updateReceiverRegistered) {
            try {
                unregisterReceiver(updateDownloadReceiver);
            } catch (Throwable ignored) {
                // 이미 해제된 경우 무시한다.
            }
        }
        updateHandler.removeCallbacksAndMessages(null);
        updateExecutor.shutdownNow();
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }

    private static final class UpdateInfo {
        final int versionCode;
        final String versionName;
        final String downloadUrl;
        final String message;
        final boolean required;

        UpdateInfo(int versionCode, String versionName, String downloadUrl, String message, boolean required) {
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.downloadUrl = downloadUrl;
            this.message = message;
            this.required = required;
        }
    }
}
