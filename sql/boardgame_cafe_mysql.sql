-- =========================================================
-- Board Game Cafe Management - MySQL Schema (สำหรับเว็บแอป)
-- แปลงจาก boardgame_cafe_sqlserver.sql ให้ตรงกับ business logic ล่าสุด
-- ใช้ MySQL 8.0+ (รองรับ CHECK constraint)
-- =========================================================

CREATE DATABASE IF NOT EXISTS boardgame_cafe
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE boardgame_cafe;

CREATE TABLE tbl_customer (
  CustomerID   INT AUTO_INCREMENT PRIMARY KEY,
  FirstName    VARCHAR(50) NOT NULL,
  LastName     VARCHAR(50) NOT NULL,
  Phone        VARCHAR(15) NOT NULL UNIQUE,
  NationalID   CHAR(13) NULL UNIQUE,
  Points       INT NOT NULL DEFAULT 0,
  CreatedDate  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT CK_customer_NationalID
    CHECK (NationalID IS NULL OR (CHAR_LENGTH(NationalID) = 13 AND NationalID REGEXP '^[0-9]{13}$'))
);

CREATE TABLE tbl_employee (
  EmployeeID  INT AUTO_INCREMENT PRIMARY KEY,
  Name        VARCHAR(100) NOT NULL,
  Position    VARCHAR(50),
  Phone       VARCHAR(15)
);

CREATE TABLE tbl_gamecategory (
  CategoryID    INT AUTO_INCREMENT PRIMARY KEY,
  CategoryName  VARCHAR(50) NOT NULL
);

CREATE TABLE tbl_boardgame (
  GameID             INT AUTO_INCREMENT PRIMARY KEY,
  Name               VARCHAR(100) NOT NULL,
  CategoryID         INT NULL,
  MinPlayer          TINYINT,
  MaxPlayer          TINYINT,
  Difficulty         VARCHAR(20),
  TotalQty           SMALLINT NOT NULL DEFAULT 1,
  AvailableQty       SMALLINT NOT NULL DEFAULT 1,
  OffsiteRentalRate  DECIMAL(10,2) NOT NULL DEFAULT 0,
  DepositAmount      DECIMAL(10,2) NOT NULL DEFAULT 0,
  CONSTRAINT CK_boardgame_qty CHECK (AvailableQty >= 0 AND AvailableQty <= TotalQty),
  FOREIGN KEY (CategoryID) REFERENCES tbl_gamecategory(CategoryID)
);

-- ชื่อ cafe_table เลี่ยงคำสงวน TABLE ของ MySQL (เหมือน tbl_table ฝั่ง SQL Server)
CREATE TABLE cafe_table (
  TableID      INT AUTO_INCREMENT PRIMARY KEY,
  Zone         VARCHAR(20),
  Capacity     TINYINT NOT NULL,
  HourlyRate   DECIMAL(10,2) NOT NULL DEFAULT 0,
  Status       VARCHAR(20) NOT NULL DEFAULT 'Available'
);

CREATE TABLE tbl_timepackage (
  PackageID        INT AUTO_INCREMENT PRIMARY KEY,
  PackageName      VARCHAR(50) NOT NULL,
  DurationMinutes  INT NULL,
  Price            DECIMAL(10,2) NOT NULL
);

CREATE TABLE tbl_queue (
  QueueID       INT AUTO_INCREMENT PRIMARY KEY,
  CustomerName  VARCHAR(100) NOT NULL,
  Phone         VARCHAR(15) NULL,
  QueueTime     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Status        VARCHAR(20) NOT NULL DEFAULT 'Waiting'
);

CREATE TABLE tbl_session (
  SessionID        INT AUTO_INCREMENT PRIMARY KEY,
  TableID          INT NOT NULL,
  CustomerID       INT NULL,
  PackageID        INT NOT NULL,
  EmployeeID       INT NOT NULL,
  StartTime        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ExpectedEndTime  DATETIME NOT NULL,
  ActualEndTime    DATETIME NULL,
  AmountPaid       DECIMAL(10,2) NOT NULL DEFAULT 0,
  Status           VARCHAR(20) NOT NULL DEFAULT 'Active',
  FOREIGN KEY (TableID) REFERENCES cafe_table(TableID),
  FOREIGN KEY (CustomerID) REFERENCES tbl_customer(CustomerID),
  FOREIGN KEY (PackageID) REFERENCES tbl_timepackage(PackageID),
  FOREIGN KEY (EmployeeID) REFERENCES tbl_employee(EmployeeID)
);

CREATE TABLE tbl_sessionextension (
  ExtensionID      INT AUTO_INCREMENT PRIMARY KEY,
  SessionID        INT NOT NULL,
  ExtendedMinutes  INT NOT NULL,
  AdditionalFee    DECIMAL(10,2) NOT NULL,
  ExtendedAt       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (SessionID) REFERENCES tbl_session(SessionID)
);

CREATE TABLE tbl_instoreborrow (
  BorrowID    INT AUTO_INCREMENT PRIMARY KEY,
  SessionID   INT NOT NULL,
  GameID      INT NOT NULL,
  BorrowTime  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ReturnTime  DATETIME NULL,
  FOREIGN KEY (SessionID) REFERENCES tbl_session(SessionID),
  FOREIGN KEY (GameID) REFERENCES tbl_boardgame(GameID)
);

CREATE TABLE tbl_offsiterental (
  RentalID         INT AUTO_INCREMENT PRIMARY KEY,
  CustomerID       INT NOT NULL,
  GameID           INT NOT NULL,
  EmployeeID       INT NOT NULL,
  RentalDate       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  DueDate          DATE NOT NULL,
  RentalFee        DECIMAL(10,2) NOT NULL,
  Deposit          DECIMAL(10,2) NOT NULL,
  Status           VARCHAR(20) NOT NULL DEFAULT 'Rented',
  ReturnDate       DATETIME NULL,
  ReturnCondition  VARCHAR(100) NULL,
  DepositRefunded  DECIMAL(10,2) NULL,
  FOREIGN KEY (CustomerID) REFERENCES tbl_customer(CustomerID),
  FOREIGN KEY (GameID) REFERENCES tbl_boardgame(GameID),
  FOREIGN KEY (EmployeeID) REFERENCES tbl_employee(EmployeeID)
);

-- =========================================================
-- ข้อมูลตัวอย่าง (ให้ตรงกับฝั่ง SQL Server เพื่อทดสอบเว็บ)
-- =========================================================
INSERT INTO tbl_gamecategory (CategoryName) VALUES ('Strategy'),('Party'),('Family'),('Card Game');

INSERT INTO tbl_boardgame (Name, CategoryID, MinPlayer, MaxPlayer, Difficulty, TotalQty, AvailableQty, OffsiteRentalRate, DepositAmount) VALUES
('Catan', 1, 3, 4, 'Medium', 2, 2, 100, 500),
('Codenames', 2, 4, 8, 'Easy', 3, 3, 80, 300),
('Ticket to Ride', 1, 2, 5, 'Medium', 2, 2, 100, 500),
('Uno', 4, 2, 10, 'Easy', 5, 5, 40, 100),
('Carcassonne', 3, 2, 5, 'Easy', 2, 2, 90, 400);

INSERT INTO cafe_table (Zone, Capacity, HourlyRate, Status) VALUES
('A', 4, 50, 'Available'), ('A', 6, 70, 'Available'),
('B', 2, 40, 'Available'), ('B', 8, 100, 'Occupied'),
('VIP', 6, 150, 'Available');

INSERT INTO tbl_timepackage (PackageName, DurationMinutes, Price) VALUES
('1 ชั่วโมง', 60, 60), ('2 ชั่วโมง', 120, 110), ('เหมาวัน', NULL, 300);

INSERT INTO tbl_employee (Name, Position, Phone) VALUES
('Somchai', 'Staff', '0811111111'), ('Suda', 'Manager', '0822222222');

INSERT INTO tbl_customer (FirstName, LastName, Phone, NationalID, Points) VALUES
('Jay', 'P.', '0991234567', '1234567890123', 100),
('Ploy', 'S.', '0987654321', NULL, 0);

-- ตัวอย่าง session ที่กำลังเล่นอยู่ (โต๊ะ #4)
INSERT INTO tbl_session (TableID, CustomerID, PackageID, EmployeeID, StartTime, ExpectedEndTime, AmountPaid, Status) VALUES
(4, 1, 2, 1, NOW(), DATE_ADD(NOW(), INTERVAL 90 MINUTE), 110, 'Active');

INSERT INTO tbl_queue (CustomerName, Phone, Status) VALUES
('คุณเอ', '0801112222', 'Waiting');
