"""LocalLens 代码高亮示例"""
from dataclasses import dataclass

@dataclass
class FileRecord:
    name: str
    size: int

    def human_size(self) -> str:
        units = ["B", "KB", "MB", "GB"]
        n, i = float(self.size), 0
        while n >= 1024 and i < 3:
            n /= 1024
            i += 1
        return f"{n:.1f} {units[i]}"

if __name__ == "__main__":
    print(FileRecord("demo.py", 4096).human_size())
