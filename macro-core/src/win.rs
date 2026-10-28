//! Реальный ввод в Windows через SendInput.
//!
//! Клавиши отправляются сканкодами (KEYEVENTF_SCANCODE) — так их видят и игры на DirectInput/RawInput.

use crate::input::{InputBackend, KeyReader};
use crate::keys::is_extended;
use crate::model::Button;
use std::mem::size_of;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
    SM_YVIRTUALSCREEN, WHEEL_DELTA,
};

pub struct WindowsInput;
pub struct WindowsKeys;

fn send(input: INPUT) -> Result<(), String> {
    let sent = unsafe { SendInput(1, &input, size_of::<INPUT>() as i32) };
    if sent == 1 {
        Ok(())
    } else {
        Err("SendInput не сработал (если игра запущена от администратора — запустите и программу от администратора)".into())
    }
}

fn mouse(dx: i32, dy: i32, data: u32, flags: u32) -> Result<(), String> {
    let mi = MOUSEINPUT {
        dx,
        dy,
        mouseData: data,
        dwFlags: flags,
        time: 0,
        dwExtraInfo: 0,
    };
    send(INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 { mi },
    })
}

impl InputBackend for WindowsInput {
    fn key(&self, vk: u16, down: bool) -> Result<(), String> {
        let scan = unsafe { MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC) } as u16;
        let mut flags = if down { 0 } else { KEYEVENTF_KEYUP };
        if scan != 0 {
            flags |= KEYEVENTF_SCANCODE;
        }
        if is_extended(vk) {
            flags |= KEYEVENTF_EXTENDEDKEY;
        }
        let ki = KEYBDINPUT {
            wVk: if scan != 0 { 0 } else { vk },
            wScan: scan,
            dwFlags: flags,
            time: 0,
            dwExtraInfo: 0,
        };
        send(INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki },
        })
    }

    fn mouse_button(&self, button: Button, down: bool) -> Result<(), String> {
        let (flags, data) = match (button, down) {
            (Button::Left, true) => (MOUSEEVENTF_LEFTDOWN, 0),
            (Button::Left, false) => (MOUSEEVENTF_LEFTUP, 0),
            (Button::Right, true) => (MOUSEEVENTF_RIGHTDOWN, 0),
            (Button::Right, false) => (MOUSEEVENTF_RIGHTUP, 0),
            (Button::Middle, true) => (MOUSEEVENTF_MIDDLEDOWN, 0),
            (Button::Middle, false) => (MOUSEEVENTF_MIDDLEUP, 0),
            (Button::X1, true) => (MOUSEEVENTF_XDOWN, 1),
            (Button::X1, false) => (MOUSEEVENTF_XUP, 1),
            (Button::X2, true) => (MOUSEEVENTF_XDOWN, 2),
            (Button::X2, false) => (MOUSEEVENTF_XUP, 2),
        };
        mouse(0, 0, data, flags)
    }

    fn mouse_move(&self, x: i32, y: i32, relative: bool) -> Result<(), String> {
        if relative {
            return mouse(x, y, 0, MOUSEEVENTF_MOVE);
        }
        let (vx, vy, vw, vh) = unsafe {
            (
                GetSystemMetrics(SM_XVIRTUALSCREEN),
                GetSystemMetrics(SM_YVIRTUALSCREEN),
                GetSystemMetrics(SM_CXVIRTUALSCREEN),
                GetSystemMetrics(SM_CYVIRTUALSCREEN),
            )
        };
        let norm = |v: i32, origin: i32, size: i32| -> i32 {
            let span = (size.max(2) - 1) as i64;
            (((v - origin) as i64 * 65535) / span).clamp(0, 65535) as i32
        };
        mouse(
            norm(x, vx, vw),
            norm(y, vy, vh),
            0,
            MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
        )
    }

    fn scroll(&self, notches: i32) -> Result<(), String> {
        let delta = notches.saturating_mul(WHEEL_DELTA as i32);
        mouse(0, 0, delta as u32, MOUSEEVENTF_WHEEL)
    }
}

impl KeyReader for WindowsKeys {
    fn is_down(&self, vk: u16) -> bool {
        (unsafe { GetAsyncKeyState(vk as i32) } as u16 & 0x8000) != 0
    }
}
