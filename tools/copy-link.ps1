# 就活アプリの「合言葉入りリンク」をクリップボードに入れ、このPCの既定ブラウザでも開く
# 使い方: powershell -ExecutionPolicy Bypass -File tools\copy-link.ps1
# 合言葉は じぶんノート と共通(本体は ~/.claude/jibun-token.txt。リポジトリには入れない)。画面には表示しない。
$tokenFile = Join-Path $env:USERPROFILE '.claude\jibun-token.txt'
if (-not (Test-Path $tokenFile)) { Write-Host '合言葉のファイルが見つかりません'; exit 1 }
$token = (Get-Content $tokenFile -Raw -Encoding utf8).Trim()
$url = 'https://neitianguang209-oss.github.io/shukatsu-app/#k=' + [uri]::EscapeDataString($token)
Set-Clipboard -Value $url
Start-Process $url
Write-Host 'リンクをコピーしました。iPhoneにはLINEの自分用トークなどで送って、ホーム画面のアプリと同じ開き方で開いてください。'
