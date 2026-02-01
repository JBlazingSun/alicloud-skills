# ossutil 2.0 安装（按平台）

> 以文档示例版本为参考，具体版本以官方页面为准。

## Linux

```bash
sudo yum install unzip -y
curl -o ossutil.zip https://gosspublic.alicdn.com/ossutil/2.2.0/ossutil-v2.2.0-linux-amd64.zip
unzip ossutil.zip
sudo chmod 755 ossutil-v2.2.0-linux-amd64/ossutil
sudo mv ossutil-v2.2.0-linux-amd64/ossutil /usr/local/bin/ossutil
```

## macOS

```bash
curl -o ossutil.zip https://gosspublic.alicdn.com/ossutil/2.2.0/ossutil-v2.2.0-darwin-amd64.zip
unzip ossutil.zip
sudo chmod 755 ossutil-v2.2.0-darwin-amd64/ossutil
sudo mv ossutil-v2.2.0-darwin-amd64/ossutil /usr/local/bin/ossutil
```

## Windows

- 下载对应平台压缩包并解压。
- 将 `ossutil.exe` 所在目录加入系统 `PATH`。
- 在 PowerShell/CMD 中运行 `ossutil`。
