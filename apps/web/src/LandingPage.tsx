import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { api } from "./api";
import { NotificationToast, useNotification } from "./Feedback";
import "./landing.css";

type PublicPlan = {
  code: string;
  name: string;
  description: string;
  monthlyPrice: number | null;
  quoteLimit: number | null;
  templateLimit: number | null;
  active: boolean;
  featured: boolean;
  displayOrder: number;
};

const fallbackPlans: PublicPlan[] = [
  { code: "free", name: "Dùng thử", description: "Khám phá cách Giáo giúp bạn làm báo giá nhanh hơn.", monthlyPrice: 0, quoteLimit: 20, templateLimit: 1, active: true, featured: false, displayOrder: 0 },
  { code: "starter", name: "Khởi đầu", description: "Dành cho doanh nghiệp có nhu cầu báo giá thường xuyên.", monthlyPrice: 199_000, quoteLimit: 200, templateLimit: 3, active: true, featured: false, displayOrder: 1 },
  { code: "pro", name: "Pro", description: "Đủ sức cho quy trình báo giá mỗi ngày của đội ngũ kinh doanh.", monthlyPrice: 499_000, quoteLimit: 1_000, templateLimit: 10, active: true, featured: true, displayOrder: 2 },
  { code: "business", name: "Business", description: "Hạn mức rộng rãi cho khối lượng báo giá lớn và đa chi nhánh.", monthlyPrice: 1_490_000, quoteLimit: 3_000, templateLimit: 30, active: true, featured: false, displayOrder: 3 },
  { code: "enterprise", name: "Enterprise", description: "Gói tùy chỉnh theo nhu cầu riêng của doanh nghiệp.", monthlyPrice: null, quoteLimit: null, templateLimit: null, active: true, featured: false, displayOrder: 4 },
  { code: "contact", name: "Liên hệ", description: "Trao đổi với chúng tôi để tìm giải pháp tối ưu cho doanh nghiệp.", monthlyPrice: null, quoteLimit: null, templateLimit: null, active: true, featured: false, displayOrder: 5 },
];

function LandingIcon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    spark: (
      <>
        <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
        <path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
      </>
    ),
    list: (
      <>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <path d="M3 6h.01M3 12h.01M3 18h.01" />
      </>
    ),
    check: (
      <>
        <path d="m5 12 4 4L19 6" />
        <circle cx="12" cy="12" r="9" />
      </>
    ),
    file: (
      <>
        <path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
        <path d="M14 3v5h5M9 13h6M9 17h6" />
      </>
    ),
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    upload: (
      <>
        <path d="M12 16V4m0 0L7 9m5-5 5 5" />
        <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </>
    ),
    shield: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    zap: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
    cross: <path d="M18 6 6 18M6 6l12 12" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    layers: (
      <>
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
      </>
    ),
    cpu: (
      <>
        <rect width="16" height="16" x="4" y="4" rx="2" />
        <path d="M9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.check}
    </svg>
  );
}

function Brand() {
  return (
    <a className="landing-brand" href="/" aria-label="Giáo — Trang chủ">
      <span className="landing-brand-mark">G</span>
      <span className="landing-brand-name">
        giáo<small>TRỢ LÝ BÁO GIÁ AI</small>
      </span>
    </a>
  );
}

type DemoScenario = {
  id: string;
  category: string;
  title: string;
  clientMessage: string;
  clientSender: string;
  companyName: string;
  quoteNumber: string;
  matchedCount: number;
  items: {
    name: string;
    code: string;
    unit: string;
    quantity: number;
    price: number;
    total: number;
  }[];
  totalAmount: number;
};

const demoScenarios: DemoScenario[] = [
  {
    id: "construction",
    category: "Vật liệu xây dựng",
    title: "Xi măng & Thép công trình",
    clientSender: "Anh Hùng (Chỉ huy trưởng CT-02)",
    clientMessage: "Em ơi check bảng giá gửi gấp anh 120 bao xi măng PCB40 với 40 cây thép D16 về kho trước 4h chiều nhé!",
    companyName: "CÔNG TY CP VẬT LIỆU TOÀN CẦU",
    quoteNumber: "BG-2026-00382",
    matchedCount: 2,
    items: [
      { name: "Xi măng PCB40 Hoàng Thạch", code: "XM-HT-40", unit: "Bao 50kg", quantity: 120, price: 105_000, total: 12_600_000 },
      { name: "Thép xây dựng D16 Hòa Phát", code: "THEP-HP-16", unit: "Cây 11.7m", quantity: 40, price: 720_000, total: 28_800_000 },
    ],
    totalAmount: 41_400_000,
  },
  {
    id: "electrical",
    category: "Cơ điện & M&E",
    title: "Aptomat & Dây cáp điện",
    clientSender: "Chị Lan (Ban QLDA Tòa nhà Sunrise)",
    clientMessage: "Báo giá nhanh cho bên chị: 15 cái Aptomat 3P 63A Schneider và 3 cuộn Cáp điện đơn Cadisun 4.0 để duyệt thầu.",
    companyName: "THIẾT BỊ ĐIỆN CÔNG NGHIỆP THÁI DƯƠNG",
    quoteNumber: "BG-2026-00419",
    matchedCount: 2,
    items: [
      { name: "Aptomat 3P 63A Schneider EasyPact", code: "CB-SCH-63", unit: "Cái", quantity: 15, price: 450_000, total: 6_750_000 },
      { name: "Dây cáp điện đơn Cadisun Cu/PVC 1x4.0", code: "CAP-CADI-40", unit: "Cuộn 100m", quantity: 3, price: 1_280_000, total: 3_840_000 },
    ],
    totalAmount: 10_590_000,
  },
  {
    id: "furniture",
    category: "Nội thất văn phòng",
    title: "Bàn họp & Ghế công thái học",
    clientSender: "Anh Tuấn (Công ty Công nghệ Nova)",
    clientMessage: "Shop làm báo giá giúp mình: 1 Bàn họp dài 2m4 x 1m2 chân sắt sơn tĩnh điện và 8 ghế xoay lưới chống mỏi lưng.",
    companyName: "NỘI THẤT VĂN PHÒNG HIỆN ĐẠI AN PHÁT",
    quoteNumber: "BG-2026-00507",
    matchedCount: 2,
    items: [
      { name: "Bàn họp chân sắt mặt gỗ MFC 2.4m", code: "BH-MFC-24", unit: "Chiếc", quantity: 1, price: 5_600_000, total: 5_600_000 },
      { name: "Ghế xoay lưới Ergonomic cao cấp", code: "GHE-ERGO-01", unit: "Chiếc", quantity: 8, price: 950_000, total: 7_600_000 },
    ],
    totalAmount: 13_200_000,
  },
];

function InteractiveQuotePreview() {
  const [activeScenarioId, setActiveScenarioId] = useState<string>("construction");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const activeScenario = demoScenarios.find((s) => s.id === activeScenarioId) ?? demoScenarios[0];

  const handleSelectScenario = (id: string) => {
    if (id === activeScenarioId) return;
    setIsProcessing(true);
    setTimeout(() => {
      setActiveScenarioId(id);
      setIsProcessing(false);
    }, 280);
  };

  return (
    <div className="landing-preview-wrap" aria-label="Mô phỏng trực quan tương tác tạo báo giá thông minh bằng AI">
      {/* Dynamic Ambient Glow Behind Card */}
      <div className="preview-glow-bg" />
      <div className="preview-orbit preview-orbit-one" />
      <div className="preview-orbit preview-orbit-two" />

      {/* Floating Badge Top */}
      <div className="preview-float preview-float-top">
        <span className="preview-float-icon">
          <LandingIcon name="spark" size={17} />
        </span>
        <span>
          <strong>AI nhận diện chuẩn xác</strong>
          <small>Khớp 100% mã hàng trong bảng giá</small>
        </span>
        <i className="pulse-indicator" />
      </div>

      {/* Main Interactive Container */}
      <div className="landing-demo-card">
        {/* Scenario Switcher Tabs */}
        <div className="demo-tabs-bar">
          <span className="demo-tabs-label">
            <LandingIcon name="cpu" size={14} /> Thử kịch bản:
          </span>
          <div className="demo-tabs-group">
            {demoScenarios.map((scenario) => (
              <button
                key={scenario.id}
                type="button"
                className={`demo-tab-btn ${scenario.id === activeScenarioId ? "active" : ""}`}
                onClick={() => handleSelectScenario(scenario.id)}
              >
                {scenario.category}
              </button>
            ))}
          </div>
        </div>

        {/* Input Message Simulation */}
        <div className="demo-client-bubble">
          <div className="demo-client-meta">
            <span className="demo-client-dot" />
            <span className="demo-client-sender">{activeScenario.clientSender}</span>
            <span className="demo-client-tag">Tin nhắn Zalo/Email</span>
          </div>
          <p className="demo-client-text">“{activeScenario.clientMessage}”</p>
        </div>

        {/* Processing Indicator Beam */}
        <div className={`demo-ai-bridge ${isProcessing ? "processing" : ""}`}>
          <span className="ai-bridge-pill">
            <LandingIcon name="zap" size={13} />
            {isProcessing ? "AI đang đối chiếu bảng giá..." : "Đã đối chiếu bảng giá doanh nghiệp"}
          </span>
        </div>

        {/* Generated Quote Sheet Preview */}
        <article className={`quote-preview-card ${isProcessing ? "fade-out" : "fade-in"}`}>
          <div className="quote-preview-top">
            <span className="preview-company-mark">G</span>
            <span>
              <strong>{activeScenario.companyName}</strong>
              <small>Bảng giá đã đồng bộ · Cập nhật hôm nay</small>
            </span>
            <span className="preview-status-badge">SẴN SÀNG GỬI</span>
          </div>

          <div className="quote-preview-title">
            <div className="quote-preview-subline">
              <small>BẢN BÁO GIÁ ĐÃ KHỚP GIÁ</small>
              <span>{activeScenario.quoteNumber}</span>
            </div>
            <h3>{activeScenario.title}</h3>
          </div>

          <div className="quote-preview-table">
            <div className="quote-preview-row preview-table-head">
              <span>SẢN PHẨM KHỚP ĐƯỢC</span>
              <span>ĐVT</span>
              <span>SL</span>
              <span>THÀNH TIỀN</span>
            </div>
            {activeScenario.items.map((item) => (
              <div className="quote-preview-row" key={item.code}>
                <span>
                  <b>{item.name}</b>
                  <small>Mã: {item.code}</small>
                </span>
                <span>{item.unit}</span>
                <span className="row-qty">{item.quantity}</span>
                <b>{new Intl.NumberFormat("vi-VN").format(item.total)}đ</b>
              </div>
            ))}
          </div>

          <div className="quote-preview-total">
            <div className="total-label-wrap">
              <span>Tổng cộng tiền hàng</span>
              <small>Đã bao gồm thuế GTGT & chiết khấu</small>
            </div>
            <strong>{new Intl.NumberFormat("vi-VN").format(activeScenario.totalAmount)}đ</strong>
          </div>

          <div className="quote-preview-bottom">
            <span>
              <i className="status-dot-green" /> Đơn giá trích xuất trực tiếp từ bảng giá gốc
            </span>
            <div className="preview-export-badges">
              <span>Xuất Excel</span>
              <span>Xuất PDF</span>
            </div>
          </div>
        </article>
      </div>

      {/* Floating Badge Bottom */}
      <div className="preview-float preview-float-bottom">
        <span className="preview-check">
          <LandingIcon name="check" size={18} />
        </span>
        <span>
          <strong>Không lo lệch giá</strong>
          <small>Bạn luôn kiểm tra & duyệt trước khi gửi khách</small>
        </span>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [plans, setPlans] = useState<PublicPlan[]>(fallbackPlans);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactBusy, setContactBusy] = useState(false);
  const [contactDraft, setContactDraft] = useState({ name: "", companyName: "", email: "", phone: "", message: "" });
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const { notification, notify, dismiss } = useNotification();

  useEffect(() => {
    let cancelled = false;
    api<{ plans: PublicPlan[] }>("/api/plans")
      .then(({ plans: activePlans }) => {
        if (!cancelled && activePlans.length) setPlans(activePlans);
      })
      .catch((cause) => {
        if (!cancelled) notify(cause instanceof Error ? cause.message : "Không tải được các gói dịch vụ.", "error");
      });
    return () => {
      cancelled = true;
    };
  }, [notify]);

  const freePlan = plans.find((plan) => plan.code === "free");

  const closeContact = () => {
    setContactOpen(false);
  };

  const submitContact = async (event: FormEvent) => {
    event.preventDefault();
    setContactBusy(true);
    try {
      await api("/api/plan-contact-requests", { method: "POST", body: JSON.stringify(contactDraft) });
      setContactDraft({ name: "", companyName: "", email: "", phone: "", message: "" });
      setContactOpen(false);
      notify("Đã gửi yêu cầu tư vấn thành công.", "success");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Không gửi được yêu cầu. Vui lòng thử lại.", "error");
    } finally {
      setContactBusy(false);
    }
  };

  const faqs = [
    {
      q: "Giáo có tự ý 'bịa' giá hoặc lấy giá từ trên mạng không?",
      a: "Hoàn toàn không. Giáo hoạt động dựa trên nguyên tắc nghiêm ngặt: toàn bộ đơn giá và thông số sản phẩm bắt buộc phải đối chiếu khớp với file bảng giá Excel/PDF mà doanh nghiệp của bạn tải lên. AI chỉ hỗ trợ đọc hiểu văn bản yêu cầu và tra cứu nhanh.",
    },
    {
      q: "Công ty tôi có mẫu báo giá riêng (màu sắc, logo, điều khoản), Giáo có hỗ trợ không?",
      a: "Có! Bạn có thể tải mẫu Excel/Word hoặc định dạng mẫu của doanh nghiệp lên hệ thống. Khi xuất file báo giá, Giáo sẽ tự động điền toàn bộ thông tin vào đúng mẫu sẵn có của bạn mà không làm thay đổi định dạng hay thương hiệu công ty.",
    },
    {
      q: "Khách gửi yêu cầu bằng file ảnh chụp, file Word hay tin nhắn Zalo thì làm thế nào?",
      a: "Bạn chỉ cần copy nguyên văn tin nhắn của khách hoặc tải tệp (ảnh, tài liệu, danh sách) lên. AI của Giáo sẽ tự động trích lọc các mặt hàng, quy cách và số lượng mà khách cần để tiến hành khớp giá.",
    },
    {
      q: "Dữ liệu bảng giá và thông tin khách hàng của công ty có được bảo mật không?",
      a: "Dữ liệu bảng giá và các bản báo giá của bạn thuộc quyền sở hữu riêng biệt của tài khoản doanh nghiệp bạn. Chúng tôi cam kết không chia sẻ dữ liệu hoặc sử dụng thông tin kinh doanh của bạn để huấn luyện mô hình bên ngoài.",
    },
    {
      q: "Tôi có được dùng thử miễn phí trước khi mua gói không?",
      a: "Chắc chắn rồi. Ngay khi đăng ký tài khoản, bạn được tặng gói Dùng thử miễn phí với đầy đủ tính năng phân tích AI và xuất báo giá để bạn trải nghiệm thực tế trên chính bảng giá của mình.",
    },
  ];

  return (
    <>
    <main className="landing-page">
      {/* Background Ambient Orbs */}
      <div className="landing-bg-orb landing-bg-orb-1" />
      <div className="landing-bg-orb landing-bg-orb-2" />

      {/* HEADER / NAVBAR */}
      <header className="landing-header">
        <div className="landing-container landing-nav">
          <Brand />
          <nav className="landing-nav-links" aria-label="Điều hướng">
            <a href="#tinh-nang">Tính năng</a>
            <a href="#so-sanh">So sánh</a>
            <a href="#cach-hoat-dong">Cách hoạt động</a>
            <a href="#bang-gia">Bảng giá</a>
            <a href="#faq">Hỏi đáp</a>
          </nav>
          <div className="landing-nav-actions">
            <a className="landing-signin" href="/dang-nhap">
              Đăng nhập
            </a>
            <a className="landing-button landing-button-small landing-button-glow" href="/dang-ky">
              <span>Dùng thử miễn phí</span>
              <LandingIcon name="arrow" size={15} />
            </a>
          </div>
          <a className="landing-mobile-login" href="/dang-nhap">
            Đăng nhập
          </a>
        </div>
      </header>

      {/* HERO SECTION */}
      <section className="landing-hero">
        <div className="landing-container landing-hero-grid">
          <div className="landing-hero-copy">
            <div className="landing-kicker">
              <span>
                <LandingIcon name="spark" size={14} />
              </span>
              TRỢ LÝ BÁO GIÁ AI THÔNG MINH
            </div>
            <h1>
              Tạo báo giá nhanh.<br />
              <em>Chốt việc tự tin.</em>
            </h1>
            <p className="landing-hero-description">
              Biến tin nhắn, email hoặc yêu cầu rời rạc của khách thành bản báo giá chuẩn xác trong 30 giây.
              Giáo tự động đối chiếu bảng giá riêng của bạn, tính toán thành tiền và xuất file theo đúng mẫu doanh nghiệp.
            </p>

            <div className="landing-hero-actions">
              <a className="landing-button landing-button-hero landing-button-glow" href="/dang-ky">
                <span>Bắt đầu miễn phí ngay</span>
                <LandingIcon name="arrow" size={18} />
              </a>
              <a className="landing-text-link" href="#tinh-nang">
                <span>Khám phá tính năng</span>
                <span className="arrow-down">↓</span>
              </a>
            </div>

            <div className="landing-hero-note">
              <span className="landing-avatar-stack">
                <i>XD</i>
                <i>M&E</i>
                <i>NT</i>
              </span>
              <span>
                <strong>
                  {freePlan?.quoteLimit == null
                    ? "Tặng lượt tạo báo giá miễn phí trải nghiệm"
                    : `Dùng thử với ${new Intl.NumberFormat("vi-VN").format(freePlan.quoteLimit)} lượt tạo báo giá miễn phí`}
                </strong>
                <small>Không yêu cầu thẻ thanh toán · Kích hoạt ngay trong 10 giây</small>
              </span>
            </div>
          </div>

          <InteractiveQuotePreview />
        </div>

        {/* Benefits Strip */}
        <div className="landing-hero-bottom">
          <div className="landing-container landing-benefits">
            <span>
              <LandingIcon name="check" size={17} /> 100% Đơn giá từ bảng giá chính thức của bạn
            </span>
            <span>
              <LandingIcon name="check" size={17} /> Xuất đúng mẫu Excel &amp; PDF công ty
            </span>
            <span>
              <LandingIcon name="check" size={17} /> Bạn toàn quyền kiểm tra trước khi gửi khách
            </span>
          </div>
        </div>
      </section>

      {/* STATS STRIP */}
      <section className="landing-stats-section">
        <div className="landing-container">
          <div className="landing-stats-grid">
            <div className="landing-stat-item">
              <strong>10.000+</strong>
              <span>Bản báo giá đã được tạo thành công</span>
            </div>
            <div className="landing-stat-divider" />
            <div className="landing-stat-item">
              <strong>&lt; 2 phút</strong>
              <span>Thời gian phản hồi khách hàng trung bình</span>
            </div>
            <div className="landing-stat-divider" />
            <div className="landing-stat-item">
              <strong>99.4%</strong>
              <span>Độ chính xác đối chiếu đơn giá &amp; mã hàng</span>
            </div>
            <div className="landing-stat-divider" />
            <div className="landing-stat-item">
              <strong>5x</strong>
              <span>Tốc độ hoàn thiện báo giá so với làm tay</span>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES SECTION */}
      <section id="tinh-nang" className="landing-section landing-features">
        <div className="landing-container">
          <div className="landing-section-heading">
            <span className="landing-eyebrow">QUY TRÌNH BÁO GIÁ ĐẲNG CẤP</span>
            <h2>
              Từ tin nhắn lộn xộn của khách<br />
              thành bản báo giá chuyên nghiệp.
            </h2>
            <p>
              Loại bỏ hoàn toàn công đoạn gõ tay từng dòng, lục lọi file Excel cũ hay tính toán nhầm lẫn.
              Giáo làm thay bạn những việc lặp lại nhàm chán nhất.
            </p>
          </div>

          <div className="landing-feature-grid">
            <article className="landing-feature-card">
              <div className="card-shine-effect" />
              <span className="landing-feature-icon feature-icon-teal">
                <LandingIcon name="spark" size={24} />
              </span>
              <h3>AI đọc hiểu mọi định dạng</h3>
              <p>
                Dán nguyên văn tin nhắn Zalo, email hay tải file đính kèm. Giáo tự động bóc tách từng mặt hàng, quy cách và số lượng mà khách cần.
              </p>
              <div className="feature-pill">Nhận diện thông minh</div>
              <span className="feature-index">01</span>
            </article>

            <article className="landing-feature-card">
              <div className="card-shine-effect" />
              <span className="landing-feature-icon feature-icon-sand">
                <LandingIcon name="list" size={24} />
              </span>
              <h3>Đối chiếu bảng giá gốc của bạn</h3>
              <p>
                Tìm đúng mặt hàng từ kho giá doanh nghiệp bạn đã tải lên. Tự động tính toán thành tiền, thuế GTGT và áp dụng chiết khấu chuẩn xác.
              </p>
              <div className="feature-pill">Không lo sai giá</div>
              <span className="feature-index">02</span>
            </article>

            <article className="landing-feature-card">
              <div className="card-shine-effect" />
              <span className="landing-feature-icon feature-icon-green">
                <LandingIcon name="file" size={24} />
              </span>
              <h3>Xuất theo mẫu công ty bạn</h3>
              <p>
                Tải mẫu Excel hoặc PDF có sẵn logo, thông tin doanh nghiệp và điều khoản bảo hành. Bấm xuất là có ngay file hoàn chỉnh để gửi khách.
              </p>
              <div className="feature-pill">Giữ nguyên thương hiệu</div>
              <span className="feature-index">03</span>
            </article>
          </div>
        </div>
      </section>

      {/* COMPARISON MATRIX (TRƯỚC VÀ SAU) */}
      <section id="so-sanh" className="landing-section landing-comparison">
        <div className="landing-container">
          <div className="landing-section-heading">
            <span className="landing-eyebrow">HIỆU QUẢ VƯỢT TRỘI</span>
            <h2>Tại sao các đội ngũ kinh doanh chuyển sang dùng Giáo?</h2>
            <p>Xem sự khác biệt rõ rệt giữa cách làm báo giá thủ công và khi có Trợ lý AI đồng hành.</p>
          </div>

          <div className="comparison-table-wrap">
            <div className="comparison-column comparison-old">
              <div className="comparison-col-header">
                <span className="comparison-badge badge-old">CÁCH LÀM CŨ</span>
                <h3>Làm báo giá thủ công</h3>
                <p>Mệt mỏi, tốn thời gian và dễ nhầm giá</p>
              </div>
              <ul className="comparison-list">
                <li>
                  <span className="icon-cross"><LandingIcon name="cross" size={15} /></span>
                  <span>Mất từ 30 đến 45 phút cho mỗi báo giá phức tạp</span>
                </li>
                <li>
                  <span className="icon-cross"><LandingIcon name="cross" size={15} /></span>
                  <span>Dễ gõ sai mã hàng hoặc áp nhầm đơn giá từ file Excel cũ</span>
                </li>
                <li>
                  <span className="icon-cross"><LandingIcon name="cross" size={15} /></span>
                  <span>Phải copy/paste từng dòng vào file mẫu rất mất công</span>
                </li>
                <li>
                  <span className="icon-cross"><LandingIcon name="cross" size={15} /></span>
                  <span>Khách phải chờ đợi lâu, dễ bị đối thủ khác báo trước chốt mất</span>
                </li>
              </ul>
            </div>

            <div className="comparison-column comparison-new">
              <div className="comparison-col-header">
                <span className="comparison-badge badge-new">VỚI GIÁO AI</span>
                <h3>Trợ lý báo giá tự động</h3>
                <p>Nhanh chóng, chuẩn xác và chốt đơn tự tin</p>
              </div>
              <ul className="comparison-list">
                <li>
                  <span className="icon-check"><LandingIcon name="check" size={15} /></span>
                  <span>Chỉ mất <strong>dưới 2 phút</strong> từ lúc nhận tin nhắn đến lúc gửi file</span>
                </li>
                <li>
                  <span className="icon-check"><LandingIcon name="check" size={15} /></span>
                  <span>Khớp giá <strong>chính xác 100%</strong> từ bảng giá doanh nghiệp đã kiểm duyệt</span>
                </li>
                <li>
                  <span className="icon-check"><LandingIcon name="check" size={15} /></span>
                  <span>Tự động điền dữ liệu vào <strong>đúng mẫu Excel / PDF công ty</strong></span>
                </li>
                <li>
                  <span className="icon-check"><LandingIcon name="check" size={15} /></span>
                  <span>Phản hồi khách tức thì, tạo ấn tượng chuyên nghiệp &amp; tỷ lệ chốt cao</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* PROCESS SECTION */}
      <section id="cach-hoat-dong" className="landing-process">
        <div className="landing-container landing-process-grid">
          <div className="landing-process-copy">
            <span className="landing-eyebrow">3 BƯỚC ĐƠN GIẢN</span>
            <h2>
              Thêm dữ liệu một lần.<br />
              Báo giá nhanh mỗi ngày.
            </h2>
            <p>
              Bạn không cần cài đặt phần mềm phức tạp. Chỉ cần tải bảng giá sản phẩm lên một lần,
              Giáo sẽ phụ trách toàn bộ việc tra cứu và tính toán cho bạn.
            </p>
            <a className="landing-button landing-button-outline" href="/dang-ky">
              <span>Tạo tài khoản dùng thử</span>
              <LandingIcon name="arrow" size={16} />
            </a>
          </div>

          <div className="landing-steps">
            <article className="landing-step">
              <span className="step-number">1</span>
              <div>
                <h3>Tải bảng giá &amp; mẫu của công ty</h3>
                <p>Tải file Excel bảng giá sản phẩm và mẫu báo giá bạn đang sử dụng lên hệ thống.</p>
              </div>
              <span className="step-step-icon">
                <LandingIcon name="upload" size={20} />
              </span>
            </article>

            <article className="landing-step">
              <span className="step-number">2</span>
              <div>
                <h3>Gửi nội dung yêu cầu của khách</h3>
                <p>Dán đoạn chat Zalo, nội dung email hoặc tải file đính kèm của khách để AI bóc tách.</p>
              </div>
              <span className="step-step-icon">
                <LandingIcon name="spark" size={20} />
              </span>
            </article>

            <article className="landing-step">
              <span className="step-number">3</span>
              <div>
                <h3>Kiểm tra và xuất file gửi khách</h3>
                <p>Xem lại bảng tính đã khớp tự động, chỉnh sửa số lượng nếu cần rồi xuất file gửi đi.</p>
              </div>
              <span className="step-step-icon">
                <LandingIcon name="check" size={20} />
              </span>
            </article>
          </div>
        </div>
      </section>

      {/* TRUST BANNER */}
      <section className="landing-trust">
        <div className="landing-container landing-trust-inner">
          <div className="trust-icon">
            <LandingIcon name="shield" size={26} />
          </div>
          <div>
            <h2>Bảo mật tuyệt đối &amp; Dữ liệu luôn nằm trong tay bạn</h2>
            <p>
              Giáo chỉ sử dụng bảng giá bạn tải lên để phục vụ việc tính toán riêng của doanh nghiệp bạn.
              Mọi bản báo giá đều cần bạn duyệt trước khi gửi, đảm bảo kiểm soát 100%.
            </p>
          </div>
          <div className="trust-detail">
            <span>
              <LandingIcon name="clock" size={16} /> Tiết kiệm 80% thời gian nhập liệu
            </span>
            <span>
              <LandingIcon name="check" size={16} /> Bạn chủ động duyệt trước khi xuất
            </span>
          </div>
        </div>
      </section>

      {/* PRICING SECTION */}
      <section id="bang-gia" className="landing-section landing-pricing">
        <div className="landing-container">
          <div className="landing-section-heading">
            <span className="landing-eyebrow">BẢNG GIÁ MINH BẠCH</span>
            <h2>
              Bắt đầu miễn phí,<br />
              nâng cấp khi doanh nghiệp mở rộng.
            </h2>
            <p>Không có phí ẩn. Bạn chỉ nâng cấp khi số lượng báo giá hàng tháng tăng lên.</p>
          </div>

          <div className="landing-pricing-grid">
            {plans.map((plan) => {
              const monthlyPrice = plan.monthlyPrice;
              if (plan.code === "contact") {
                return (
                  <article className="landing-plan-card landing-plan-enterprise landing-plan-contact" key={plan.code}>
                    <div className="enterprise-copy">
                      <span className="landing-eyebrow">GÓI TƯ VẤN DOANH NGHIỆP</span>
                      <h3>{plan.name}</h3>
                      <p>{plan.description || "Trao đổi với chúng tôi để thiết kế giải pháp và hạn mức phù hợp nhất."}</p>
                      <span className="enterprise-limits">Tùy biến luồng duyệt, mẫu báo giá và tích hợp ERP riêng theo yêu cầu</span>
                    </div>
                    <button
                      type="button"
                      className="plan-cta plan-cta-outline"
                      onClick={() => {
                        setContactOpen(true);
                      }}
                    >
                      <span>Liên hệ tư vấn</span>
                      <LandingIcon name="arrow" size={15} />
                    </button>
                  </article>
                );
              }
              const quoteLimit =
                plan.quoteLimit == null
                  ? "Hạn mức linh hoạt theo nhu cầu"
                  : `${new Intl.NumberFormat("vi-VN").format(plan.quoteLimit)} lượt tạo báo giá / tháng`;
              const templateLimit =
                plan.templateLimit == null
                  ? "Số lượng mẫu tùy biến"
                  : `${new Intl.NumberFormat("vi-VN").format(plan.templateLimit)} mẫu báo giá lưu trữ`;

              if (monthlyPrice === null) {
                return (
                  <article className="landing-plan-card landing-plan-enterprise" key={plan.code}>
                    <div className="enterprise-copy">
                      <span className="landing-eyebrow">GÓI TÙY CHỈNH</span>
                      <h3>{plan.name}</h3>
                      <p>{plan.description || "Trao đổi với chúng tôi để chọn hạn mức báo giá phù hợp."}</p>
                      <span className="enterprise-limits">
                        {quoteLimit} · {templateLimit}
                      </span>
                    </div>
                    <a href="/dang-ky" className="plan-cta plan-cta-outline">
                      <span>Bắt đầu dùng thử</span>
                      <LandingIcon name="arrow" size={15} />
                    </a>
                  </article>
                );
              }

              return (
                <article
                  className={`landing-plan-card ${plan.featured ? "landing-plan-featured" : ""}`}
                  key={plan.code}
                >
                  {plan.featured && (
                    <>
                      <div className="plan-popular-beam" />
                      <span className="plan-popular">ĐƯỢC CHỌN NHIỀU NHẤT</span>
                    </>
                  )}
                  <div className="plan-card-heading">
                    <h3>{plan.name}</h3>
                    <p>{plan.description}</p>
                  </div>
                  <div className="plan-price">
                    <strong>
                      {monthlyPrice === 0 ? "Miễn phí" : `${new Intl.NumberFormat("vi-VN").format(monthlyPrice)}đ`}
                    </strong>
                    {monthlyPrice > 0 && <span>/ tháng</span>}
                  </div>
                  <a
                    className={`plan-cta ${plan.featured ? "plan-cta-primary" : "plan-cta-outline"}`}
                    href={`/dang-ky?plan=${encodeURIComponent(plan.code)}`}
                  >
                    <span>{monthlyPrice === 0 ? "Bắt đầu miễn phí" : "Dùng thử gói này"}</span>
                    <LandingIcon name="arrow" size={15} />
                  </a>
                  <div className="plan-divider" />
                  <ul className="plan-includes">
                    <li>
                      <LandingIcon name="check" size={16} />
                      <span>{quoteLimit}</span>
                    </li>
                    <li>
                      <LandingIcon name="check" size={16} />
                      <span>{templateLimit}</span>
                    </li>
                    <li>
                      <LandingIcon name="check" size={16} />
                      <span>Tải &amp; đối chiếu bảng giá riêng</span>
                    </li>
                    <li>
                      <LandingIcon name="check" size={16} />
                      <span>AI phân tích yêu cầu từ đoạn chat/tệp</span>
                    </li>
                    <li>
                      <LandingIcon name="check" size={16} />
                      <span>Xuất file Excel &amp; PDF chuẩn mẫu</span>
                    </li>
                  </ul>
                </article>
              );
            })}
          </div>
          <p className="landing-pricing-note">
            Hạn mức lượt tạo báo giá được làm mới hàng tháng. Bạn có thể nâng cấp hoặc hủy gói bất kỳ lúc nào.
          </p>
        </div>
      </section>

      {/* FAQ SECTION */}
      <section id="faq" className="landing-section landing-faq">
        <div className="landing-container">
          <div className="landing-section-heading">
            <span className="landing-eyebrow">GIẢI ĐÁP THẮC MẮC</span>
            <h2>Câu hỏi thường gặp</h2>
            <p>Những băn khoăn phổ biến trước khi các doanh nghiệp đưa Giáo vào quy trình hàng ngày.</p>
          </div>

          <div className="faq-accordion-wrap">
            {faqs.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div className={`faq-item ${isOpen ? "open" : ""}`} key={item.q}>
                  <button
                    type="button"
                    className="faq-question"
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    aria-expanded={isOpen}
                  >
                    <span>{item.q}</span>
                    <span className="faq-icon">
                      <LandingIcon name="chevronDown" size={18} />
                    </span>
                  </button>
                  {isOpen && (
                    <div className="faq-answer">
                      <p>{item.a}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* FINAL CALL TO ACTION */}
      <section className="landing-final-cta">
        <div className="landing-container landing-final-inner">
          <div className="final-cta-content">
            <span className="landing-eyebrow">SẴN SÀNG TĂNG TỐC BÁO GIÁ?</span>
            <h2>
              Để Giáo lo phần nhập liệu.<br />
              Bạn tập trung chốt hợp đồng.
            </h2>
            <p>Bắt đầu ngay hôm nay và trải nghiệm tốc độ làm báo giá chưa từng có.</p>
          </div>
          <a className="landing-button landing-button-light landing-button-glow-light" href="/dang-ky">
            <span>Bắt đầu miễn phí ngay</span>
            <LandingIcon name="arrow" size={18} />
          </a>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="landing-footer">
        <div className="landing-container landing-footer-inner">
          <Brand />
          <span className="footer-copyright">© 2026 Giáo · Trợ lý thông minh cho quy trình báo giá doanh nghiệp</span>
          <div className="footer-links">
            <a href="/dang-nhap">Đăng nhập</a>
            <a href="#tinh-nang">Tính năng</a>
            <a href="#bang-gia">Bảng giá</a>
          </div>
        </div>
      </footer>

      {/* CONTACT MODAL */}
      {contactOpen && (
        <div
          className="landing-contact-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeContact();
          }}
        >
          <section className="landing-contact-modal" role="dialog" aria-modal="true" aria-labelledby="landing-contact-title">
            <div className="landing-contact-heading">
              <div>
                <span className="landing-eyebrow">LIÊN HỆ TƯ VẤN</span>
                <h2 id="landing-contact-title">Tìm gói phù hợp với doanh nghiệp</h2>
                <p>Để lại thông tin, đội ngũ Giáo sẽ liên hệ trao đổi chi tiết trong vòng 24h.</p>
              </div>
              <button type="button" className="landing-contact-close" onClick={closeContact} aria-label="Đóng">
                ×
              </button>
            </div>

            <form className="landing-contact-form" onSubmit={(event) => void submitContact(event)}>
                <div className="landing-contact-fields">
                  <label>
                    Họ và tên *
                    <input
                      autoComplete="name"
                      maxLength={200}
                      value={contactDraft.name}
                      onChange={(event) => setContactDraft({ ...contactDraft, name: event.target.value })}
                      required
                    />
                  </label>
                  <label>
                    Tên doanh nghiệp *
                    <input
                      autoComplete="organization"
                      maxLength={200}
                      value={contactDraft.companyName}
                      onChange={(event) => setContactDraft({ ...contactDraft, companyName: event.target.value })}
                      required
                    />
                  </label>
                  <label>
                    Email liên hệ *
                    <input
                      type="email"
                      autoComplete="email"
                      maxLength={250}
                      value={contactDraft.email}
                      onChange={(event) => setContactDraft({ ...contactDraft, email: event.target.value })}
                      required
                    />
                  </label>
                  <label>
                    Số điện thoại
                    <input
                      type="tel"
                      autoComplete="tel"
                      maxLength={50}
                      value={contactDraft.phone}
                      onChange={(event) => setContactDraft({ ...contactDraft, phone: event.target.value })}
                    />
                  </label>
                  <label className="landing-contact-message">
                    Nhu cầu của doanh nghiệp *
                    <textarea
                      rows={4}
                      maxLength={5000}
                      value={contactDraft.message}
                      onChange={(event) => setContactDraft({ ...contactDraft, message: event.target.value })}
                      placeholder="Chia sẻ quy mô nhân sự, số lượng báo giá mỗi tháng hoặc yêu cầu đặc biệt của doanh nghiệp…"
                      required
                    />
                  </label>
                </div>
                <div className="landing-contact-actions">
                  <button type="button" className="landing-contact-cancel" onClick={closeContact}>
                    Để sau
                  </button>
                  <button type="submit" className="landing-button" disabled={contactBusy}>
                    {contactBusy ? "Đang gửi…" : "Gửi thông tin tư vấn"}
                    <LandingIcon name="arrow" size={16} />
                  </button>
                </div>
              </form>
          </section>
        </div>
      )}
    </main>
    {notification && <NotificationToast notification={notification} onDismiss={dismiss} />}
    </>
  );
}
