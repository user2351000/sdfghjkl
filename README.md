# GitHub Actions リモートデスクトップ

GitHub Actions で Chrome をブラウザから利用するリポジトリです。

## 利用方法

### 1. リポジトリをコピーする

1.  [![Use this template](https://img.shields.io/badge/Use%20this%20template-2ea44f?style=for-the-badge&logo=github&logoColor=white)](https://github.com/user2351000/chrome-github-actions-/generate)
このボタンをクリックします。
2. GitHub のリポジトリ作成画面が開きます。
3. **Owner** で自分のアカウントを選択します。
4. **Repository name** に任意のリポジトリ名を入力します。
5. **Create repository** をクリックします。
6. 作成された自分のリポジトリを開きます。

### 2. Chromeを起動する

1. 自分のリポジトリページで **Actions** を開きます。
2. **Chrome** をクリックします。
3. **Run workflow** を押して起動します。
4. 実行中のジョブを開き、ログから `https://<ランダム文字列>.trycloudflare.com` を探します。
5. URLをブラウザで開くと、Chromeを利用できます。

### 3. 停止方法

停止するときは次の操作を行います。

停止方法はあるけど6時間で自動で切れる&自動で保存なので放置

ジョブを手動でキャンセルすることでも停止できます。

## Chrome プロファイル

Chromeのみ、ログイン状態を次回の実行に引き継ぐ機能があります。

利用には、リポジトリの **Settings → Secrets and variables → Actions → Repository secrets** で `CHROME_STATE_ENCRYPTION_KEY` を登録してください。

キーは次のサイトなどで生成できます。

[![ここを クリック](https://img.shields.io/badge/Generate-Base64-blue?style=for-the-badge)](https://generate-random.org/base64-string)

出力された32バイトのBase64文字列をそのままシークレット値に設定します。

**実行ごとにキーを変更しないでください。**
