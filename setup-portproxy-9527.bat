@echo off
chcp 65001 >nul
echo ========================================================
echo   正在为 vben-build-dashboard 配置 Windows 9527 端口映射
echo ========================================================

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [错误] 请以管理员身份运行此批处理脚本！
    echo （右键点击此文件，选择“以管理员身份运行”）
    echo.
    pause
    exit /b 1
)

for /f "tokens=2 delims=:" %%a in ('wsl -d Ubuntu-22.04 ip -4 addr show eth0 ^| findstr "inet"') do (
    for /f "tokens=1 delims=/" %%b in ("%%a") do set WSL_IP=%%b
)
set WSL_IP=%WSL_IP: =%

echo [1/2] 检测到当前 WSL IP: %WSL_IP%
echo [2/2] 正在添加端口转发规则: 9527 -> %WSL_IP%:9527 ...

netsh interface portproxy delete v4tov4 listenport=9527 listenaddress=0.0.0.0 >nul 2>&1
netsh interface portproxy delete v4tov4 listenport=9527 listenaddress=127.0.0.1 >nul 2>&1

netsh interface portproxy add v4tov4 listenport=9527 listenaddress=0.0.0.0 connectport=9527 connectaddress=%WSL_IP%
netsh interface portproxy add v4tov4 listenport=9527 listenaddress=127.0.0.1 connectport=9527 connectaddress=%WSL_IP%

echo.
echo ✔ 配置完成！当前端口转发状态表：
netsh interface portproxy show all

echo.
echo ========================================================
echo 现在你可以在浏览器中直接访问:
echo 👉 http://localhost:9527/
echo ========================================================
pause
